// Synthetic workloads, not production captures. Names describe actual frontend jobs.
export const scenarios = {
  editor: {
    title: 'Design editor — drag, layout, collaboration',
    operation: 'dragSelection', incident: 'large-selection-layout',
    namespaces: ['editor', 'layout', 'renderer', 'collaboration'],
    jobs: ['reducePointerInput', 'resolveConstraints', 'paintScene', 'mergeRemoteChanges'],
    tasks: ['updateSelection', 'measureText', 'uploadTexture', 'applyPatch'],
    detail: { documentNodes: 18000, selectedNodes: 240, collaborators: 12 },
    channel: 'editor.scene', resource: 'scene-tile', heapMb: 240,
  },
  maps: {
    title: 'Live map — pan, vector tiles, vehicle updates',
    operation: 'updateViewport', incident: 'cold-tile-cache',
    namespaces: ['navigation', 'tiles', 'map-renderer', 'live-data'],
    jobs: ['integratePan', 'decodeVectorTiles', 'rebuildSymbolAtlas', 'reconcileVehicles'],
    tasks: ['projectCoordinate', 'decodeFeature', 'placeLabel', 'updateVehicle'],
    detail: { visibleTiles: 64, visibleVehicles: 8500, zoom: 14 },
    channel: 'maps.tiles', resource: 'vector-tile', heapMb: 310,
  },
  game: {
    title: 'Multiplayer arena — simulation and particle burst',
    operation: 'tick', incident: 'particle-burst-and-reconciliation',
    namespaces: ['input', 'physics', 'webgl', 'network'],
    jobs: ['sampleControls', 'stepSimulation', 'renderWorld', 'reconcileServerTick'],
    tasks: ['resolveAction', 'testCollision', 'drawParticleBatch', 'applySnapshot'],
    detail: { entities: 2400, players: 32, particleEmitters: 160 },
    channel: 'game.simulation', resource: 'texture-atlas', heapMb: 380,
  },
  video: {
    title: 'Video editor — timeline scrub and effect preview',
    operation: 'previewFrame', incident: 'effect-cache-invalidation',
    namespaces: ['timeline', 'decoder', 'effects', 'compositor'],
    jobs: ['resolvePlayhead', 'deliverDecodedFrame', 'applyEffectGraph', 'composePreview'],
    tasks: ['findClip', 'copyFramePlane', 'evaluateEffect', 'blendLayer'],
    detail: { tracks: 12, width: 3840, height: 2160, effectsPerClip: 8 },
    channel: 'video.preview', resource: 'media-segment', heapMb: 520,
  },
};
