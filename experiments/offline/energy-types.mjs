// Offline check: can Homebridge's pipeline carry SolarPower / BatteryStorage /
// ElectricalMeter if a plugin supplies the device type itself?
// Mirrors AccessoryManager: electrical helpers -> PowerSource -> BridgedDeviceBasicInformation
// -> aggregator.add -> DescriptorServer.addDeviceTypes('ElectricalSensor'|'PowerSource').
import { ServerNode, Endpoint, Environment, Network, MockNetwork, NetworkSimulator, StorageService, StorageBackendMemory } from '@matter/main';
// No IPv6 in this container: run matter.js on its in-memory network simulator and memory storage.
Environment.default.set(Network, new MockNetwork(new NetworkSimulator(), '00:11:22:33:44:55', ['10.0.0.2', 'fdce::2']));
Environment.default.get(StorageService).factory = () => new StorageBackendMemory();
import { AggregatorEndpoint } from '@matter/main/endpoints/aggregator';
import { SolarPowerDevice, BatteryStorageDevice, ElectricalMeterDevice } from '@matter/main/devices';
import { DeviceEnergyManagementServer } from '@matter/main/behaviors/device-energy-management';
import { PowerSourceServer } from '@matter/main/behaviors/power-source';
import { BridgedDeviceBasicInformationServer } from '@matter/main/behaviors/bridged-device-basic-information';
import { DescriptorServer } from '@matter/main/behaviors/descriptor';
import { detectElectricalMeasurementClusters, applyElectricalMeasurementDefaults, applyElectricalMeasurementClusters } from './node_modules/homebridge/dist/matter/serverHelpers.js';

const kw = (w) => w * 1000; // W -> mW
// DEM base cluster (no features): mandatory esaType/esaCanGenerate/esaState/absMin/absMaxPower
const dem = (esaType, canGenerate, min, max) => ({ esaType, esaCanGenerate: canGenerate, esaState: 1, absMinPower: kw(min), absMaxPower: kw(max) });

const accessories = [
  { id: 'solar', type: SolarPowerDevice.with(DeviceEnergyManagementServer), extra: ['DeviceEnergyManagement'],
    clusters: {
      electricalPowerMeasurement: { activePower: -kw(3200) },
      electricalEnergyMeasurement: { cumulativeEnergyExported: { energy: 12_345_000 } },
      powerSource: { status: 1, order: 0, description: 'PV', wiredCurrentType: 1 /* DC */ },
      deviceEnergyManagement: dem(6 /* SolarPv */, true, -8000, 0),
    }, psFeatures: ['Wired'] },
  { id: 'battery', type: BatteryStorageDevice.with(DeviceEnergyManagementServer), extra: ['DeviceEnergyManagement'],
    clusters: {
      electricalPowerMeasurement: { activePower: kw(1500), powerMode: 1 /* DC */ },
      electricalEnergyMeasurement: { cumulativeEnergyImported: { energy: 1 }, cumulativeEnergyExported: { energy: 2 } },
      powerSource: { status: 1, order: 0, description: 'Battery', batPercentRemaining: 170, batChargeLevel: 0, batReplaceability: 0,
                     batChargeState: 1, batFunctionalWhileCharging: true },
      deviceEnergyManagement: dem(5 /* BatteryStorage */, true, -5000, 5000),
    }, psFeatures: ['Battery', 'Rechargeable'] },
  { id: 'grid-meter', type: ElectricalMeterDevice, extra: [],
    clusters: {
      electricalPowerMeasurement: { activePower: kw(-450) },
      electricalEnergyMeasurement: { cumulativeEnergyImported: { energy: 9_000_000 }, cumulativeEnergyExported: { energy: 4_000_000 } },
    } },
];

const node = await ServerNode.create({ id: 'probe', network: { port: 0 }, productDescription: { name: 'probe', deviceType: AggregatorEndpoint.deviceType } });
const agg = new Endpoint(AggregatorEndpoint, { id: 'agg' });
await node.add(agg);

for (const a of accessories) {
  const acc = { displayName: a.id, clusters: a.clusters };
  const det = detectElectricalMeasurementClusters(acc);
  applyElectricalMeasurementDefaults(acc, det);
  let t = applyElectricalMeasurementClusters(a.type, acc, det);
  if (a.psFeatures) t = t.with(PowerSourceServer.with(...a.psFeatures));
  t = t.with(BridgedDeviceBasicInformationServer);
  try {
    const ep = new Endpoint(t, { id: a.id, ...acc.clusters,
      bridgedDeviceBasicInformation: { nodeLabel: a.id, reachable: true } });
    await agg.add(ep);
    for (const dt of ['ElectricalSensor', ...(a.psFeatures ? ['PowerSource'] : []), ...a.extra])
      await ep.act(ag => ag.get(DescriptorServer).addDeviceTypes(dt));
    const dts = ep.state.descriptor.deviceTypeList.map(d => `0x${d.deviceType.toString(16).padStart(4, '0')}`);
    const cls = ep.state.descriptor.serverList.map(c => `0x${c.toString(16)}`);
    console.log(`OK   ${a.id}: deviceTypeList=[${dts}] serverList=[${cls}]`);
    console.log(`     activePower=${ep.state.electricalPowerMeasurement.activePower} mW` +
      (ep.state.deviceEnergyManagement ? ` esaType=${ep.state.deviceEnergyManagement.esaType}` : '') +
      (ep.state.powerSource?.batPercentRemaining !== undefined ? ` batPercentRemaining=${ep.state.powerSource.batPercentRemaining}` : ''));
    // live update the same way updateAccessoryState ends up doing it
    await ep.set({ electricalPowerMeasurement: { activePower: -kw(3000) } });
  } catch (e) { let c = e, out = []; while (c) { out.push(c.message); c = c.cause; } console.log(`FAIL ${a.id}: ` + out.join(" <- ")); }
}
process.exit(0);
