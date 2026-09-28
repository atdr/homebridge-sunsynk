import { ServerNode, Endpoint, Environment, Network, MockNetwork, NetworkSimulator, StorageService, StorageBackendMemory } from '@matter/main';
import { AggregatorEndpoint } from '@matter/main/endpoints/aggregator';
import { SolarPowerDevice } from '@matter/main/devices';
import { PowerSourceServer as PSmain } from '@matter/main/behaviors/power-source';
import { PowerSourceServer as PSnode } from '@matter/node/behaviors';
Environment.default.set(Network, new MockNetwork(new NetworkSimulator(), '00:11:22:33:44:55', ['10.0.0.2', 'fdce::2']));
Environment.default.get(StorageService).factory = () => new StorageBackendMemory();
const node = await ServerNode.create({ id: 'ps', network: { port: 0 } });
const agg = new Endpoint(AggregatorEndpoint, { id: 'agg' }); await node.add(agg);
console.log('same class main/node:', PSmain === PSnode, 'features:', JSON.stringify(PSnode.cluster.supportedFeatures));
const cases = {
  base_wiredAttr: [SolarPowerDevice.with(PSnode), { status: 1, order: 0, description: 'PV', wiredCurrentType: 1 }],
  base_noWired: [SolarPowerDevice.with(PSnode), { status: 1, order: 0, description: 'PV' }],
  wired: [SolarPowerDevice.with(PSnode.with('Wired')), { status: 1, order: 0, description: 'PV', wiredCurrentType: 1 }],
  wired_then_base: [SolarPowerDevice.with(PSnode.with('Wired')).with(PSnode), { status: 1, order: 0, description: 'PV', wiredCurrentType: 1 }],
};
for (const [k, [t, ps]] of Object.entries(cases)) {
  try { await agg.add(new Endpoint(t, { id: k, powerSource: ps })); console.log('OK  ', k); }
  catch (e) { let c = e, o = []; while (c) { o.push(c.message); c = c.cause; } console.log('FAIL', k, o.slice(-1)[0]); }
}
process.exit(0);
