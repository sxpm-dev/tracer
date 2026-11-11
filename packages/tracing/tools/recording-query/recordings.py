#!/usr/bin/env python3
"""Offline, standard-library-only queries for editor/platform JSONL recordings."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile

VERSION = 2


def fingerprint(path):
    st = path.stat()
    return {'size': st.st_size, 'mtime_ns': st.st_mtime_ns}


def files(directory, session):
    if Path(session).name != session or session in ('.', '..'):
        raise ValueError('Session must be an ID, not a path')
    return directory / (session + '.jsonl'), directory / (session + '.meta.json')


def union(intervals):
    end = float('-inf')
    total = 0.0
    for start, stop in sorted(intervals):
        total += max(0, stop - max(start, end))
        end = max(end, stop)
    return total


def derive_ray(rows):
    """Clip/union direct children; elapsed self is not CPU time."""
    by_id = {r[0]: r for r in rows}
    children = {}
    missing = 0
    for eid, parent, at, duration, kind in rows:
        if parent is None or kind != 'call':
            continue
        p = by_id.get(parent)
        if p is None:
            missing += 1
        elif duration is not None and p[3] is not None:
            start, stop = max(at, p[2]), min(at + duration, p[2] + p[3])
            if stop > start:
                children.setdefault(parent, []).append((start, stop))
    return [(None if r[3] is None else max(0, r[3] - union(children.get(r[0], []))), r[0]) for r in rows], missing


def build(directory, cache, session, force=False):
    source, meta_path = files(directory, session)
    metadata = json.loads(meta_path.read_text())
    if metadata.get('status') != 'complete':
        raise ValueError('Only completed recordings can be indexed')
    stamp = {'version': VERSION, 'source': fingerprint(source), 'meta': fingerprint(meta_path)}
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / (session + '.sqlite')
    if target.exists() and not force:
        with sqlite3.connect(target) as db:
            try:
                if json.loads(db.execute("SELECT value FROM info WHERE key='stamp'").fetchone()[0]) == stamp:
                    return target
            except sqlite3.DatabaseError:
                pass
    fd, tmp = tempfile.mkstemp(dir=cache, suffix='.building')
    os.close(fd)
    db = sqlite3.connect(tmp)
    try:
        db.executescript('''
PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-32768;
CREATE TABLE info(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE methods(mid INTEGER PRIMARY KEY,namespace TEXT,name TEXT);
CREATE TABLE rays(rid INTEGER PRIMARY KEY,ray TEXT UNIQUE,root_mid INTEGER,root_count INTEGER DEFAULT 0);
CREATE TABLE events(rid INTEGER,eid INTEGER,parent INTEGER,mid INTEGER,at REAL,duration REAL,self REAL,error INTEGER,kind TEXT,PRIMARY KEY(rid,eid)) WITHOUT ROWID;
CREATE TABLE chunks(rid INTEGER,offset INTEGER,length INTEGER);
CREATE TABLE samples(type TEXT,at REAL,metric TEXT,value REAL,data TEXT);
''')
        methods, rays, types = {}, {}, {}
        digest = hashlib.sha256()
        calls = markers = lines = 0
        with source.open('rb') as stream:
            while True:
                offset = stream.tell()
                line = stream.readline()
                if not line:
                    break
                digest.update(line)
                if not line.strip():
                    continue
                lines += 1
                record = json.loads(line)
                kind = record.get('type', 'unknown')
                types[kind] = types.get(kind, 0) + 1
                if kind == 'events':
                    ray = record['ray']
                    if ray not in rays:
                        rays[ray] = len(rays) + 1
                        db.execute('INSERT INTO rays(rid,ray) VALUES (?,?)', (rays[ray], ray))
                    rid = rays[ray]
                    db.execute('INSERT INTO chunks VALUES (?,?,?)', (rid, offset, len(line)))
                    batch = []
                    for event in record['events']:
                        key = (event.get('namespace', ''), event['name'])
                        if key not in methods:
                            methods[key] = len(methods) + 1
                            db.execute('INSERT INTO methods VALUES (?,?,?)', (methods[key], *key))
                        ek = event.get('kind', 'call')
                        calls += ek == 'call'
                        markers += ek != 'call'
                        batch.append((rid, event['id'], event.get('parent'), methods[key], event['at'], event.get('duration'), None, int(event.get('status') == 'error'), ek))
                        if event.get('parent') is None and ek == 'call':
                            db.execute('UPDATE rays SET root_mid=coalesce(root_mid,?), root_count=root_count+1 WHERE rid=?', (methods[key], rid))
                    db.executemany('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)', batch)
                else:
                    sample = record.get('sample', record.get('snapshot', record))
                    db.execute('INSERT INTO samples VALUES (?,?,?,?,?)', (kind, sample.get('at'), sample.get('metric'), sample.get('value') if isinstance(sample.get('value'), (float,int)) else None, json.dumps(record, separators=(',', ':'))))
                if lines % 25000 == 0:
                    db.commit()
                    print(f'{session}: {lines:,} records, {calls:,} calls indexed', file=sys.stderr)
        missing = 0
        # Only the largest single ray is materialized, never the whole recording.
        read = db.execute('SELECT rid,eid,parent,at,duration,kind FROM events ORDER BY rid,eid')
        current, rows = None, []
        def flush(rid, rows):
            derived, absent = derive_ray(rows)
            db.executemany('UPDATE events SET self=? WHERE rid=? AND eid=?', ((value, rid, eid) for value, eid in derived))
            return absent
        for rid, *row in read:
            if current is not None and rid != current:
                missing += flush(current, rows)
                rows = []
            current = rid
            rows.append(row)
        if current is not None:
            missing += flush(current, rows)
        db.executescript('CREATE INDEX events_method ON events(mid); CREATE INDEX events_time ON events(at); CREATE INDEX chunks_ray ON chunks(rid);')
        db.executescript('''
CREATE TABLE method_stats AS SELECT mid,count(*) calls,count(duration) completed,sum(duration) totalMs,sum(self) selfMs,min(duration) minMs,max(duration) maxMs,sum(error) errors,sum(duration IS NULL) unfinished FROM events WHERE kind='call' GROUP BY mid;
CREATE UNIQUE INDEX method_stats_mid ON method_stats(mid);
CREATE INDEX event_roots ON events(mid) WHERE parent IS NULL AND kind='call';
CREATE TABLE root_stats AS SELECT root_mid,count(*) calls,count(duration) completed,sum(duration) totalMs,sum(self) selfMs,min(duration) minMs,max(duration) maxMs,sum(error) errors,sum(duration IS NULL) unfinished FROM events JOIN rays USING(rid) WHERE kind='call' GROUP BY root_mid;
''')
        if stamp['source'] != fingerprint(source) or stamp['meta'] != fingerprint(meta_path):
            raise ValueError('Recording changed during indexing; retry after upload completes')
        info = {'stamp': stamp, 'metadata': metadata, 'sha256': digest.hexdigest(), 'types': types, 'integrity': {'calls': calls, 'markers': markers, 'missingParents': missing, 'lines': lines}}
        for key, value in info.items():
            db.execute('INSERT INTO info VALUES (?,?)', (key, json.dumps(value)))
        db.commit()
        db.close()
        os.replace(tmp, target)
        return target
    except BaseException:
        db.close()
        Path(tmp).unlink(missing_ok=True)
        raise


def connect(path):
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def info(db, key):
    return json.loads(db.execute('SELECT value FROM info WHERE key=?', (key,)).fetchone()[0])


def summary(db):
    meta = info(db, 'metadata')
    browser = [dict(r) for r in db.execute("SELECT metric,count(*) count,avg(value) mean,max(value) max FROM samples WHERE type='browser-sample' GROUP BY metric")]
    cpu = [json.loads(r[0])['sample'] for r in db.execute("SELECT data FROM samples WHERE type='cpu-sample'")]
    blocking = sum(s.get('blockingDuration', 0) for s in cpu)
    namespaces = [dict(r) for r in db.execute("SELECT m.namespace,sum(e.calls) calls,sum(e.selfMs) selfElapsedMs,sum(e.totalMs) inclusiveElapsedMs,sum(e.errors) errors FROM method_stats e JOIN methods m USING(mid) GROUP BY m.namespace")]
    channels = {r[0]: r[1] for r in db.execute("SELECT json_extract(data,'$.sample.channel') channel, count(*) FROM samples WHERE type='extension-sample' AND channel IS NOT NULL GROUP BY channel")}
    return {'session': meta['sessionId'], 'metadata': meta, 'sha256': info(db, 'sha256'), 'recordTypes': info(db, 'types'), 'warnings': ([] if meta.get('mode') == 'full' else ['Call queries cover raw events only; light-mode function aggregates are retained in samples but not merged into call statistics.']), 'integrity': {**info(db, 'integrity'), 'unfinishedCalls': db.execute("SELECT count(*) FROM events WHERE kind='call' AND duration IS NULL").fetchone()[0], 'eventsOutsideDuration': db.execute('SELECT count(*) FROM events WHERE at<0 OR at>?', (meta['duration'],)).fetchone()[0], 'raysWithMultipleRoots': db.execute('SELECT count(*) FROM rays WHERE root_count>1').fetchone()[0]}, 'extensionChannels': channels, 'namespaces': namespaces, 'browser': browser, 'longFrames': {'count': len(cpu), 'blockingMs': blocking, 'blockingMsPerSecond': blocking / (meta['duration']/1000) if meta['duration'] else None, 'maxMs': max((s.get('duration',0) for s in cpu),default=0)}}


def query(db, args):
    fast = args.command in ('methods', 'stats') and not any(getattr(args, k, None) is not None for k in ('start_ms','end_ms','root','min_ms'))
    if fast:
        return query_rollup(db, args)
    where, values = ["e.kind='call'"], []
    for flag, sql in [('name', 'm.name LIKE ?'), ('namespace', 'm.namespace=?'), ('start_ms', 'e.at>=?'), ('end_ms', 'e.at<?')]:
        value = getattr(args, flag, None)
        if value is not None:
            where.append(sql)
            values.append('%'+value+'%' if flag == 'name' else value)
    if getattr(args, 'root', None):
        where.append('e.rid IN (SELECT rid FROM rays JOIN methods ON root_mid=mid WHERE name LIKE ?)')
        values.append('%' + args.root + '%')
    if getattr(args, 'min_ms', None) is not None:
        where.append('e.duration>=?')
        values.append(args.min_ms)
    if args.command == 'calls':
        sql = 'SELECT r.ray,e.eid,e.parent,m.namespace,m.name,e.at,e.duration,e.self,e.error FROM events e JOIN methods m USING(mid) JOIN rays r USING(rid) WHERE ' + ' AND '.join(where) + ' ORDER BY e.duration DESC LIMIT ?'
        return [dict(r) for r in db.execute(sql, (*values, args.limit))]
    if args.command == 'stats':
        by = args.by
        group = {'total': None, 'namespace': 'm.namespace', 'method': 'e.mid', 'root': 'r.root_mid'}[by]
        label = {'total': "'all'", 'namespace': 'm.namespace', 'method': "m.namespace || '::' || m.name", 'root': "coalesce(rm.name,'(missing root)')"}[by]
        sql = 'SELECT ' + label + ' AS groupName,count(*) calls,sum(e.duration) totalMs,sum(e.self) selfMs,avg(e.duration) meanMs,min(e.duration) minMs,max(e.duration) maxMs,sum(e.error) errors,sum(e.duration IS NULL) unfinished FROM events e JOIN methods m USING(mid) JOIN rays r USING(rid) LEFT JOIN methods rm ON r.root_mid=rm.mid WHERE ' + ' AND '.join(where)
        if group: sql += ' GROUP BY ' + group
        sql += ' ORDER BY totalMs DESC LIMIT ?'
        return [dict(r) for r in db.execute(sql, (*values, args.limit))]
    if args.command == 'roots':
        where.append('e.parent IS NULL')
    sort = {'self': 'selfMs', 'total': 'totalMs', 'count': 'calls', 'mean': 'meanMs', 'max': 'maxMs'}[args.sort]
    sql = '''SELECT m.namespace,m.name,count(*) calls,sum(e.duration) totalMs,sum(e.self) selfMs,avg(e.duration) meanMs,max(e.duration) maxMs,sum(e.error) errors FROM events e JOIN methods m USING(mid) WHERE ''' + ' AND '.join(where) + ' GROUP BY e.mid ORDER BY ' + sort + ' DESC LIMIT ?'
    return [dict(r) for r in db.execute(sql, (*values, args.limit))]


def query_rollup(db, args):
    by = args.by if args.command == 'stats' else 'method'
    # Root filters refer to the root method in this rollup, not descendants.
    # Use event query for name/namespace filters on descendants grouped by root.
    if by == 'root' and (args.name or args.namespace):
        clone = argparse.Namespace(**vars(args)); clone.start_ms = float('-inf')
        return query(db, clone)
    table = 'root_stats' if by == 'root' else 'method_stats'
    join = 's.root_mid=m.mid' if by == 'root' else 's.mid=m.mid'
    label = {'total': "'all'", 'namespace': 'm.namespace', 'method': "m.namespace || '::' || m.name", 'root': "coalesce(m.name,'(missing root)')"}[by]
    grouping = {'total': '', 'namespace': ' GROUP BY m.namespace', 'method': ' GROUP BY s.mid', 'root': ' GROUP BY s.root_mid'}[by]
    where, values = [], []
    if args.name:where.append('m.name LIKE ?');values.append('%'+args.name+'%')
    if args.namespace:where.append('m.namespace=?');values.append(args.namespace)
    prefix = 'm.namespace,m.name,' if args.command == 'methods' else label+' AS groupName,'
    sql = 'SELECT '+prefix+'sum(s.calls) calls,sum(s.totalMs) totalMs,sum(s.selfMs) selfMs,sum(s.totalMs)/nullif(sum(s.completed),0) meanMs,min(s.minMs) minMs,max(s.maxMs) maxMs,sum(s.errors) errors,sum(s.unfinished) unfinished FROM '+table+' s LEFT JOIN methods m ON '+join
    if where:sql += ' WHERE '+' AND '.join(where)
    sort = {'self':'selfMs','total':'totalMs','count':'calls','mean':'meanMs','max':'maxMs'}[args.sort]
    sql += grouping+' ORDER BY '+sort+' DESC LIMIT ?'
    return [dict(r) for r in db.execute(sql, (*values,args.limit))]


def compare(before, after, args):
    a, b = summary(before), summary(after)
    out = args.output.resolve()
    if out.exists():
        raise ValueError('Output directory already exists; choose a new report directory')
    out.mkdir(parents=True)
    data = {'scenario': args.scenario, 'beforeLabel': args.before_label, 'afterLabel': args.after_label, 'changes': args.changes, 'before': a, 'after': b}
    (out/'comparison.json').write_text(json.dumps(data, indent=2)+'\n')
    def metrics(s):
        result = {'Duration (seconds)': s['metadata']['duration']/1000, 'Extension samples': sum(s['extensionChannels'].values()), 'Long frames': s['longFrames']['count'], 'Long-frame blocking (ms)': s['longFrames']['blockingMs'], 'Blocking per second (ms/s)': s['longFrames']['blockingMsPerSecond']}
        result.update({n['namespace']+' calls': n['calls'] for n in s['namespaces']})
        result.update({n['namespace']+' self elapsed (ms)': n['selfElapsedMs'] for n in s['namespaces']})
        result.update({n['metric']+' mean': n['mean'] for n in s['browser'] if n['metric'] in ('frame.fps', 'timer.lag', 'event.input-delay')})
        return result
    am, bm = metrics(a), metrics(b)
    lines = [f'# {args.before_label} vs {args.after_label}', '', f'**Scenario:** {args.scenario}', '', f"**Before:** `{a['session']}` — {a['metadata'].get('title','')}", f"**After:** `{b['session']}` — {b['metadata'].get('title','')}", '', f'**Changes described by analyst:** {args.changes}', '', f"**Recording modes:** {a['metadata'].get('mode')} → {b['metadata'].get('mode')}", '', '## Metrics', '', '| Metric | Before | After | Change |', '|---|---:|---:|---:|']
    for name in dict.fromkeys([*am,*bm]):
        x,y=am.get(name),bm.get(name)
        change=f'{(y/x-1)*100:+.1f}%' if x and y is not None else 'n/a'
        fmt=lambda n: f'{n:,.3f}' if n is not None else 'n/a'
        lines.append(f'| {name} | {fmt(x)} | {fmt(y)} | {change} |')
    import csv
    tables=[]
    for db in (before, after):
        tables.append({(r['namespace'],r['name']):dict(r) for r in db.execute("SELECT namespace,name,calls,totalMs,selfMs,totalMs/nullif(completed,0) meanMs,maxMs FROM method_stats JOIN methods USING(mid)")})
    with (out/'methods.csv').open('w',newline='') as f:
        writer=csv.writer(f); fields=['calls','totalMs','selfMs','meanMs','maxMs'];writer.writerow(['namespace','method',*[f'{side}_{k}' for side in ('before','after') for k in fields]])
        for key in sorted(tables[0].keys() | tables[1].keys()):writer.writerow([*key,*[table.get(key,{}).get(k) for table in tables for k in fields]])
    lines += ['', '## Interpretation and limits', '', '- Automatically generated evidence; causal conclusions require review of action counts and code changes.', '- Inclusive and self elapsed durations are not CPU time. Nested inclusive durations overlap; self subtracts the union of clipped direct-child intervals.', '- FPS is a mean of recorded samples. Event observations are thresholded and are not INP.', '- Collector settings beyond recorded metadata are unknown unless supplied in the change description. Cache snapshot count zero alone does not prove an option was disabled.', '- Recording-to-build association is analyst supplied. Verify scenario repetitions and instrumentation before attributing differences to code.', '- Missing methods are blank in methods.csv, not measured zeros.', '', 'Evidence: [comparison.json](comparison.json), [methods.csv](methods.csv).', '']
    (out/'REPORT.md').write_text('\n'.join(lines))
    return {'report': str(out/'REPORT.md')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recordings',type=Path,default=Path('.recordings'),help='Directory holding <session>.meta.json and <session>.jsonl recordings.')
    parser.add_argument('--cache',type=Path,default=Path('.recording-query-cache'),help='Directory for the rebuildable SQLite indexes.')
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('list')
    for command in ('index','summary','methods','roots','trace','stats','calls'):
        p=sub.add_parser(command);p.add_argument('session')
        if command=='index':p.add_argument('--force',action='store_true')
        if command in ('methods','roots','stats','calls'):
            p.add_argument('--root');p.add_argument('--min-ms',type=float)
            if command=='stats':p.add_argument('--by',choices=['total','namespace','method','root'],default='total')
            p.add_argument('--name');p.add_argument('--namespace');p.add_argument('--start-ms',type=float);p.add_argument('--end-ms',type=float);p.add_argument('--sort',choices=['self','total','count','mean','max'],default='self');p.add_argument('--limit',type=int,default=30)
        if command=='trace':p.add_argument('ray');p.add_argument('--limit',type=int,default=200)
    p=sub.add_parser('sql');p.add_argument('session');p.add_argument('query');p.add_argument('--params',default='[]');p.add_argument('--limit',type=int,default=100)
    p=sub.add_parser('compare');p.add_argument('before');p.add_argument('after');p.add_argument('--scenario',required=True);p.add_argument('--before-label',required=True);p.add_argument('--after-label',required=True);p.add_argument('--changes',required=True);p.add_argument('--output',type=Path)
    args=parser.parse_args();args.cache=args.cache.resolve();args.recordings=args.recordings.resolve()
    if hasattr(args,'limit') and args.limit<1:parser.error('--limit must be positive')
    if args.command=='list':
        result=[{k: m.get(k) for k in ('sessionId','title','mode','status','duration','eventCount')} for p in sorted(args.recordings.glob('*.meta.json')) for m in [json.loads(p.read_text())]]
    elif args.command=='compare':
        if args.output is None:args.output=Path('comparisons')/f'{dt.datetime.now(dt.timezone.utc):%Y%m%dT%H%M%S%fZ}-{args.before}-vs-{args.after}'
        with connect(build(args.recordings,args.cache,args.before)) as a, connect(build(args.recordings,args.cache,args.after)) as b:result=compare(a,b,args)
    else:
        path=build(args.recordings,args.cache,args.session,getattr(args,'force',False))
        with connect(path) as db:
            if args.command=='index':result={'index':str(path),'bytes':path.stat().st_size}
            elif args.command=='summary':result=summary(db)
            elif args.command in ('methods','roots','stats','calls'):result=query(db,args)
            elif args.command=='sql':
                allowed={sqlite3.SQLITE_SELECT,sqlite3.SQLITE_READ,sqlite3.SQLITE_FUNCTION,sqlite3.SQLITE_RECURSIVE}
                db.set_authorizer(lambda action,*_:sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY)
                cursor=db.execute(args.query,json.loads(args.params))
                rows=cursor.fetchmany(args.limit+1)
                result={'truncated':len(rows)>args.limit,'rows':[dict(r) for r in rows[:args.limit]]}
            else:
                total=db.execute('SELECT count(*) FROM events JOIN rays USING(rid) WHERE ray=?',(args.ray,)).fetchone()[0]
                rows=[dict(r) for r in db.execute('SELECT eid,parent,namespace,name,at,duration,self,kind,error FROM events JOIN rays USING(rid) JOIN methods USING(mid) WHERE ray=? ORDER BY at,eid LIMIT ?',(args.ray,args.limit))]
                result={'ray':args.ray,'totalEvents':total,'truncated':total>args.limit,'events':rows}
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,sqlite3.Error,KeyError) as exc:
        print(f'Error: {exc}',file=sys.stderr);sys.exit(1)
