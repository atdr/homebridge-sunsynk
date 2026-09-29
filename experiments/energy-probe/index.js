// Scratch probe: publishes synthetic inverter readings as Matter energy
// accessories in several shapes, to see which ones Apple Home's Energy tab renders.
// Values are Matter units: power in mW (signed int64), energy in mWh.
const PLATFORM = 'EnergyProbe';
const PLUGIN = 'homebridge-energy-probe';
const homebridgeMatter = require('./hbmatter');

module.exports = (api) => api.registerPlatform(PLUGIN, PLATFORM, Probe);

class Probe {
  constructor(log, config, api) {
    this.log = log; this.api = api; this.config = config;
    this.energy = { load: 0, pvImp: 0, pvExp: 0, battImp: 0, battExp: 0 };
    api.on('didFinishLaunching', () => this.start().catch(e => log.error(e.stack)));
  }

  // Homebridge treats a platform as dynamic (owner of cached accessories) only if it implements these.
  configureAccessory() {}
  configureMatterAccessory(accessory) { this.log.debug(`cached: ${accessory.displayName}`); }

  shapes(hm) {
    const m = this.api.matter, T = m.deviceTypes, uuid = (s) => m.uuid.generate(`probe-${s}`);
    const base = (id, name, deviceType, clusters) => ({
      UUID: uuid(id), displayName: name, deviceType, clusters, context: { id },
      serialNumber: `PROBE-${id}`, manufacturer: 'Probe', model: id,
    });
    return [
      // A: load as an outlet - the shape known to show tile watts
      base('load-outlet', 'Probe Load (outlet)', T.OnOffOutlet, {
        onOff: { onOff: true },
        electricalPowerMeasurement: { activePower: 0 },
        electricalEnergyMeasurement: { cumulativeEnergyImported: null },
      }),
      // B: PV as outlet, positive power, imported energy (will inflate the consumption total)
      base('pv-outlet-pos', 'Probe PV (outlet, +W)', T.OnOffOutlet, {
        onOff: { onOff: true },
        electricalPowerMeasurement: { activePower: 0 },
        electricalEnergyMeasurement: { cumulativeEnergyImported: null },
      }),
      // C: PV as a bare ElectricalSensor, negative power, exported energy (spec-correct generator)
      base('pv-sensor-neg', 'Probe PV (sensor, -W export)', T.ElectricalSensor, {
        electricalPowerMeasurement: { activePower: 0 },
        electricalEnergyMeasurement: { cumulativeEnergyImported: null, cumulativeEnergyExported: null },
      }),
      // D: battery as ElectricalSensor with signed power + battery PowerSource for SOC
      base('battery', 'Probe Battery', T.ElectricalSensor, {
        electricalPowerMeasurement: { activePower: 0, powerMode: 1 /* DC */ },
        electricalEnergyMeasurement: { cumulativeEnergyImported: null, cumulativeEnergyExported: null },
        powerSource: { status: 1, order: 0, description: 'Battery', batPercentRemaining: 100, batChargeLevel: 0, batReplaceability: 0, batChargeState: 0 },
      }),
      // E-G: Matter 1.4/1.5 energy device types Homebridge does not list in api.matter.deviceTypes.
      // SolarPower/BatteryStorage have no clusters of their own; the spec puts them on one endpoint
      // with ElectricalSensor + PowerSource + DeviceEnergyManagement. Homebridge composes and advertises
      // the first two; the plugin composes DEM and declares it in the descriptor.
      ...(hm ? [
        // Wired PowerSource is baked into the device type with defaults, NOT declared in clusters:
        // Homebridge 2.4.0 turns a battery-less clusters.powerSource into a featureless PowerSource
        // server (fails conformance) and it would also replace this Wired one. Because clusters has no
        // powerSource, Homebridge won't advertise the PowerSource device type either, so list it here.
        base('solar', 'Probe Solar (SolarPower)', hm.devices.SolarPowerDevice.with(
          hm.behaviors.DeviceEnergyManagementServer,
          hm.behaviors.PowerSourceServer.with('Wired').set({ status: 1, order: 0, description: 'PV', wiredCurrentType: 1 /* DC */ }),
        ), {
          descriptor: { deviceTypeList: [{ deviceType: 0x0017, revision: 1 }, { deviceType: 0x0011, revision: 1 }, { deviceType: 0x050d, revision: 3 }] },
          electricalPowerMeasurement: { activePower: 0 },
          electricalEnergyMeasurement: { cumulativeEnergyImported: null, cumulativeEnergyExported: null },
          deviceEnergyManagement: { esaType: 6 /* SolarPv */, esaCanGenerate: true, esaState: 1, absMinPower: -8_000_000, absMaxPower: 0 },
        }),
        base('battstore', 'Probe Battery (BatteryStorage)', hm.devices.BatteryStorageDevice.with(hm.behaviors.DeviceEnergyManagementServer), {
          descriptor: { deviceTypeList: [{ deviceType: 0x0018, revision: 2 }, { deviceType: 0x050d, revision: 3 }] },
          electricalPowerMeasurement: { activePower: 0, powerMode: 1 /* DC */ },
          electricalEnergyMeasurement: { cumulativeEnergyImported: null, cumulativeEnergyExported: null },
          powerSource: { status: 1, order: 0, description: 'Battery', batPercentRemaining: 100, batChargeLevel: 0, batReplaceability: 0, batChargeState: 0, batFunctionalWhileCharging: true },
          deviceEnergyManagement: { esaType: 5 /* BatteryStorage */, esaCanGenerate: true, esaState: 1, absMinPower: -5_000_000, absMaxPower: 5_000_000 },
        }),
        base('meter', 'Probe Grid (ElectricalMeter)', hm.devices.ElectricalMeterDevice, {
          electricalPowerMeasurement: { activePower: 0 },
          electricalEnergyMeasurement: { cumulativeEnergyImported: null, cumulativeEnergyExported: null },
        }),
      ] : []),
    ];
  }

  async start() {
    if (!this.api.isMatterEnabled?.()) { this.log.error('Matter not enabled on this bridge'); return; }
    let hm = null;
    try { hm = await homebridgeMatter(); this.log.info(`Using Homebridge's matter.js at ${hm.root}`); }
    catch (e) { this.log.warn(`${e.message}; skipping SolarPower/BatteryStorage/ElectricalMeter shapes`); }
    this.accessories = this.shapes(hm);
    this.byId = Object.fromEntries(this.accessories.map(a => [a.context.id, a.UUID]));
    await this.api.matter.registerPlatformAccessories(PLUGIN, PLATFORM, this.accessories);
    if (this.config.dumpDescriptors) setTimeout(() => this.dump().catch(e => this.log.error(e.message)), 3000);
    if (this.config.dumpDescriptors) setTimeout(() => this.dump().catch(e => this.log.error(e.message)), 3000);
    this.tick(); setInterval(() => this.tick().catch(e => this.log.error(e.message)), (this.config.intervalSec ?? 10) * 1000);
  }

  async dump() {
    for (const a of this.accessories) {
      const d = await this.api.matter.getAccessoryState(a.UUID, 'descriptor');
      const hex = (n) => '0x' + n.toString(16).padStart(4, '0');
      this.log.info();
    }
  }

  // Log what each endpoint advertises (device types + server clusters), to compare with a controller's view.
  async dump() {
    const hex = (n) => '0x' + n.toString(16).padStart(4, '0');
    for (const a of this.accessories) {
      const d = await this.api.matter.getAccessoryState(a.UUID, 'descriptor');
      this.log.info(`[dump] ${a.displayName}: deviceTypes=[${(d?.deviceTypeList ?? []).map(x => hex(x.deviceType))}] servers=[${(d?.serverList ?? []).map(hex)}]`);
    }
  }

  // Synthetic day: PV bell curve and a wavy load. The battery takes the surplus and covers the
  // deficit within its capacity and rate limits; whatever it cannot absorb or supply goes to or
  // from the grid, so the grid meter both imports (night) and exports (full battery at midday).
  // State of charge integrates over simulated time (real interval x speedup).
  sample() {
    const speedup = this.config.speedup ?? 1;
    const h = (Date.now() / 3.6e6 * speedup) % 24;
    const pv = Math.max(0, Math.sin((h - 6) / 12 * Math.PI)) * 4000;
    const load = 600 + 300 * Math.sin(h);
    const capWh = (this.config.batteryKWh ?? 5) * 1000, maxW = this.config.batteryMaxW ?? 3000, floor = 0.1;
    this.socWh ??= capWh * 0.5;
    const dtSimH = (this.config.intervalSec ?? 10) * speedup / 3600;
    const want = pv - load; // + surplus to charge, - deficit to discharge (W)
    const room = want > 0 ? (capWh - this.socWh) / dtSimH : (this.socWh - capWh * floor) / dtSimH;
    const batt = Math.sign(want) * Math.min(Math.abs(want), maxW, Math.max(0, room));
    this.socWh = Math.min(capWh, Math.max(capWh * floor, this.socWh + batt * dtSimH));
    const grid = load - pv + batt; // + import, - export (W)
    return { pv, load, batt, grid, soc: Math.round(this.socWh / capWh * 100) };
  }

  async tick() {
    const m = this.api.matter, s = this.sample(), dtH = (this.config.intervalSec ?? 10) / 3600, e = this.energy;
    e.load += s.load * dtH * 1000; e.pvImp += s.pv * dtH * 1000; e.pvExp += s.pv * dtH * 1000;
    if (s.batt > 0) e.battImp += s.batt * dtH * 1000; else e.battExp += -s.batt * dtH * 1000;
    const mw = (w) => Math.round(w * 1000), en = (mwh) => ({ energy: Math.round(mwh) });
    const { 'load-outlet': load, 'pv-outlet-pos': pvPos, 'pv-sensor-neg': pvNeg, battery: batt, solar, battstore, meter } = this.byId;
    await m.updateAccessoryState(load, 'electricalPowerMeasurement', { activePower: mw(s.load) });
    await m.updateAccessoryState(load, 'electricalEnergyMeasurement', { cumulativeEnergyImported: en(e.load) });
    await m.updateAccessoryState(pvPos, 'electricalPowerMeasurement', { activePower: mw(s.pv) });
    await m.updateAccessoryState(pvPos, 'electricalEnergyMeasurement', { cumulativeEnergyImported: en(e.pvImp) });
    await m.updateAccessoryState(pvNeg, 'electricalPowerMeasurement', { activePower: -mw(s.pv) });
    await m.updateAccessoryState(pvNeg, 'electricalEnergyMeasurement', { cumulativeEnergyImported: en(0), cumulativeEnergyExported: en(e.pvExp) });
    await m.updateAccessoryState(batt, 'electricalPowerMeasurement', { activePower: mw(s.batt) });
    await m.updateAccessoryState(batt, 'electricalEnergyMeasurement', { cumulativeEnergyImported: en(e.battImp), cumulativeEnergyExported: en(e.battExp) });
    await m.updateAccessoryState(batt, 'powerSource', { batPercentRemaining: s.soc * 2, batChargeState: s.batt > 0 ? 1 : 3 });
    if (solar) {
      e.grid = (e.grid ?? { imp: 0, exp: 0 });
      const grid = s.grid;
      if (grid > 0) e.grid.imp += grid * dtH * 1000; else e.grid.exp += -grid * dtH * 1000;
      await m.updateAccessoryState(solar, 'electricalPowerMeasurement', { activePower: -mw(s.pv) });
      await m.updateAccessoryState(solar, 'electricalEnergyMeasurement', { cumulativeEnergyImported: en(0), cumulativeEnergyExported: en(e.pvExp) });
      await m.updateAccessoryState(battstore, 'electricalPowerMeasurement', { activePower: mw(s.batt) });
      await m.updateAccessoryState(battstore, 'electricalEnergyMeasurement', { cumulativeEnergyImported: en(e.battImp), cumulativeEnergyExported: en(e.battExp) });
      await m.updateAccessoryState(battstore, 'powerSource', { batPercentRemaining: s.soc * 2, batChargeState: s.batt > 0 ? 1 : 3 });
      await m.updateAccessoryState(meter, 'electricalPowerMeasurement', { activePower: mw(grid) });
      await m.updateAccessoryState(meter, 'electricalEnergyMeasurement', { cumulativeEnergyImported: en(e.grid.imp), cumulativeEnergyExported: en(e.grid.exp) });
    }
    this.log.info(`pv=${s.pv.toFixed(0)}W load=${s.load.toFixed(0)}W batt=${s.batt.toFixed(0)}W grid=${s.grid.toFixed(0)}W soc=${s.soc}%`);
  }
}

