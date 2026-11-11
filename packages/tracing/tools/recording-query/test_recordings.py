import argparse
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest

import recordings as q


class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cache = self.root / 'cache'
        self.session = 'session-test'
        self.meta = {'sessionId': self.session, 'title': 'Fixture', 'status': 'complete', 'mode': 'full', 'duration': 100}
        (self.root / (self.session+'.meta.json')).write_text(json.dumps(self.meta))
        self.records = [
            {'type':'events','ray':'r1','events':[
                {'id':2,'parent':1,'kind':'call','name':'child','namespace':'editor','at':2,'duration':6},
                {'id':3,'parent':1,'kind':'call','name':'child','namespace':'editor','at':5,'duration':7}]},
            {'type':'events','ray':'r2','events':[{'id':1,'kind':'call','name':'root','namespace':'platform','at':20,'duration':4}]},
            {'type':'events','ray':'r1','events':[
                {'id':1,'kind':'call','name':'root','namespace':'platform','at':0,'duration':10},
                {'id':4,'parent':1,'kind':'marker','name':'hit','namespace':'platform','at':1}]},
            {'type':'browser-sample','sample':{'at':30,'metric':'frame.fps','value':50}},
            {'type':'cpu-sample','sample':{'at':40,'duration':70,'blockingDuration':20}},
            {'type':'extension-sample','sample':{'at':0,'channel':'platform.cache','data':{}}},
        ]
        self.write()

    def write(self):
        (self.root/(self.session+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in self.records))

    def test_split_rays_and_overlapping_children(self):
        path=q.build(self.root,self.cache,self.session)
        with q.connect(path) as db:
            s=q.summary(db)
            self.assertEqual(s['integrity']['calls'],4)
            self.assertEqual(s['extensionChannels'],{'platform.cache':1})
            self.assertEqual(s['integrity']['missingParents'],0)
            self.assertEqual(s['longFrames']['blockingMsPerSecond'],200)
            # Children union clipped to [0,10] is [2,10], not 6+7.
            self.assertEqual(db.execute('SELECT self FROM events WHERE rid=1 AND eid=1').fetchone()[0],2)
            args=argparse.Namespace(command='stats',by='namespace',name=None,namespace=None,start_ms=0,end_ms=10,root=None,min_ms=None,limit=10,sort='total')
            rows=q.query(db,args)
            self.assertEqual(sum(r['calls'] for r in rows),3)
            args.start_ms=None;args.end_ms=None
            self.assertEqual(sum(r['calls'] for r in q.query(db,args)),4)
            args.start_ms=0;args.end_ms=10
            args.root='root';args.by='root'
            self.assertEqual(q.query(db,args)[0]['totalMs'],23)

    def test_index_reuse_and_stale_rebuild(self):
        path=q.build(self.root,self.cache,self.session);modified=path.stat().st_mtime_ns
        q.build(self.root,self.cache,self.session)
        self.assertEqual(path.stat().st_mtime_ns,modified)
        self.records.append({'type':'browser-sample','sample':{'at':80,'metric':'frame.fps','value':30}})
        self.write();q.build(self.root,self.cache,self.session)
        with q.connect(path) as db:self.assertEqual(q.summary(db)['browser'][0]['mean'],40)

    def test_duplicate_event_rejected(self):
        self.records.append(self.records[0]);self.write()
        with self.assertRaises(q.sqlite3.IntegrityError):q.build(self.root,self.cache,self.session)
        self.assertFalse((self.cache/(self.session+'.sqlite')).exists())

    def test_sql_is_read_only_and_output_is_bounded(self):
        q.build(self.root,self.cache,self.session)
        base=[sys.executable,str(Path(q.__file__)), '--recordings', str(self.root), '--cache', str(self.cache), 'sql', self.session]
        read=subprocess.run([*base,'SELECT eid FROM events','--limit','1'],capture_output=True,text=True)
        self.assertEqual(read.returncode,0,read.stderr)
        self.assertTrue(json.loads(read.stdout)['truncated'])
        write=subprocess.run([*base,'DELETE FROM events'],capture_output=True,text=True)
        self.assertNotEqual(write.returncode,0)
        with q.connect(self.cache/(self.session+'.sqlite')) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0],5)


    def test_live_session_rejected(self):
        self.meta['status']='recording';(self.root/(self.session+'.meta.json')).write_text(json.dumps(self.meta))
        with self.assertRaises(ValueError):q.build(self.root,self.cache,self.session)

    def test_compare_preserves_identity_and_refuses_overwrite(self):
        path=q.build(self.root,self.cache,self.session)
        args=argparse.Namespace(output=self.root/'report',scenario='Hover + drag',before_label='Baseline',after_label='Fix',changes='Fixture only')
        with q.connect(path) as a,q.connect(path) as b:
            q.compare(a,b,args)
            with self.assertRaises(ValueError):q.compare(a,b,args)
        report=(args.output/'REPORT.md').read_text()
        self.assertIn('Hover + drag',report);self.assertIn('Baseline vs Fix',report)
        self.assertIn('session-test',report)


if __name__=='__main__':unittest.main()
