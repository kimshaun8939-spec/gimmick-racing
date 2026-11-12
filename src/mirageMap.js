// Mirage Canyon: shared road/terrain construction, distinct desert art and wind physics.
import {buildFoundryTrack} from './foundryTrack.js';
export {buildMirageScenery as buildScenery} from './mirageScenery.js';
export {buildMirageProps as buildProps} from './mirageProps.js';
export function buildTrack(data,scene){const tr=buildFoundryTrack(data,scene);tr.foundry=false;tr.mirage=true;tr.group.name='mirageTrack';tr.apexColor='#75f0e6';tr.offroadColors=['#efd39b','#d4a66d','#f2deb1','#c99d62'];return tr;}
