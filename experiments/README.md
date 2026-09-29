# Experiments: Sunsynk data in the iOS 27 Energy tab

Scratch code from the Matter energy investigation. Not part of the plugin; nothing here is loaded by `index.js`.

Results from running the probe against Apple Home are in [FINDINGS.md](FINDINGS.md).

## energy-probe/
Matter-only Homebridge platform (`EnergyProbe`) that publishes synthetic inverter readings in seven shapes:

| id | Shape |
|---|---|
| load-outlet | Load as `OnOffOutlet` + power/energy |
| pv-outlet-pos | PV as outlet, positive W, imported energy |
| pv-sensor-neg | PV as `ElectricalSensor`, negative W, exported energy |
| battery | `ElectricalSensor` (DC) + battery `PowerSource` |
| solar | Matter `SolarPower` (0x0017) + DeviceEnergyManagement + wired PowerSource |
| battstore | Matter `BatteryStorage` (0x0018) + DeviceEnergyManagement + battery PowerSource |
| meter | Matter `ElectricalMeter` (0x0514) as a grid meter (import/export) |

`hbmatter.js` borrows Homebridge's own matter.js instance; a plugin-local `@matter/main` is rejected ("is not a Behavior.Type").

Requires Homebridge >= 2.4.0 with Matter enabled on the bridge running it (use a dedicated child bridge).

```json
{ "platform": "EnergyProbe", "intervalSec": 10, "speedup": 60, "dumpDescriptors": true,
  "_bridge": { "username": "0E:AA:BB:CC:DD:01", "port": 51901, "matter": { "port": 5541 } } }
```

`speedup` compresses the synthetic day (60 = one day per 24 min). `dumpDescriptors` logs each endpoint's device types and clusters at startup.

Known Homebridge 2.4.0 behaviour this works around or exposes:
- A battery-less `clusters.powerSource` is composed without the `Wired` feature and fails conformance, and it replaces a plugin-composed one. `solar` bakes a wired PowerSource into the device type instead.
- Cached accessories whose type is not in `api.matter.deviceTypes` are not restored before the bridge goes online (`Cannot restore cached Matter accessory ... unknown device type`); they return when the plugin registers. Endpoint numbers stay stable.

## offline/
Checks that run without a network (matter.js mock network, since Matter needs IPv6):
`npm install`, then `node energy-types.mjs` / `node ps-test.mjs`.
To run the full Homebridge + probe on a host without IPv6: `node --import ./mocknet.mjs node_modules/homebridge/bin/homebridge -U <dir> -P <dir-containing-plugin>`.

## logger-probe/
`python3 logger_probe.py discover` — Solarman loggers answer a UDP broadcast on 48899; E-Linter does not.
`python3 logger_probe.py read <ip> <serial> [--three-phase]` — read-only Modbus reads via pysolarmanv5 on 8899.
