# Findings: Sunsynk data in the iOS 27 Energy tab

Tested 2026-09-29 with `energy-probe/` (v0.0.1 and v0.0.2) on Homebridge 2.4.0 (Node 24.20.0,
matter.js 0.17.9), running as a Matter child bridge on a Raspberry Pi. Paired with Apple Home on
iOS 27 from the same LAN. All endpoints were bridged and uncertified (test vendor ID 0xFFF1).
The probe published simulated readings every 10 s; every value checked in the Home app matched
the probe log for the same moment.

## Summary

- Apple Home uses a bridged Matter **ElectricalMeter** (0x0514) as the whole-home meter. The
  "All Home" figure equals its active power, signed: positive while importing, negative while
  exporting.
- **Outlets** with power and energy get a tile with live watts and are listed on the Energy page,
  grouped under the bridge.
- **SolarPower** (0x0017) and **BatteryStorage** (0x0018) show as "Not Supported". They add
  nothing over a plain ElectricalSensor in Apple Home today.
- A battery's own detail page shows a live percentage. The bridge page shows a battery
  percentage that froze shortly after pairing.

## Results by shape

| Shape | Room tile | Detail page | Energy views |
|---|---|---|---|
| `OnOffOutlet` + power/energy (load) | Socket, "On · 885W", live | Power, live | Energy page, under the bridge |
| `OnOffOutlet`, positive W (PV) | Socket, "On · 3.20kW", live | Power, live | Energy page, under the bridge |
| `ElectricalSensor`, negative W + exported energy (PV) | None | Power −3.09 kW | "All Home" sheet, −3.20 kW |
| `ElectricalMeter` (grid) | None | Power, signed | "All Home" sheet, and drives the "All Home" figure |
| `ElectricalSensor` (DC) + battery `PowerSource` | "Not Supported" | Power 2.14 kW, battery 95 %, charging | Not listed |
| `BatteryStorage` + DEM + battery `PowerSource` | "Not Supported" | Same as above | Not listed |
| `SolarPower` + DEM + wired `PowerSource` | "Not Supported" | Power −2.86 kW | Not listed |

Pairing listed five accessories (the three "Not Supported" shapes and the two outlets); the
bridge reported seven. The two tile-less shapes only appear in the "All Home" sheet.

## Evidence for the "All Home" figure

In the simulation the battery absorbs surplus and covers deficit within its limits, so grid
import differs from load. Screenshots against the probe log:

| Time | Load | PV | Grid meter | "All Home" |
|---|---|---|---|---|
| 02:26 | 885 W | 3.20 kW | 0 W | 0 W |
| 02:38 | 703 W | 0 W | 703 W | 703 W |
| 02:42 | 602 W | 304 W | 298 W | 298 W |
| 02:43 | 854 W | 1.33 kW | 0 W | 0 W |
| 02:46 | 407 W | 3.53 kW | −3.12 kW | −3.12 kW |
| 02:46 | 448 W | 3.44 kW | −2.99 kW | −2.99 kW |

"All Home" tracked the grid meter in every case, including 02:42, where it differed from both
load and PV. It is not a sum of the probe's devices, which would have been several kilowatts.

## Battery percentage

- Both battery endpoints showed the live simulated charge on their own detail pages (95 % at
  02:26, then 52 % later as it fell).
- The bridge page, and the Grid and PV sensor detail pages, showed "Battery Level 87 %, Charging
  Yes" throughout. 87 % was the simulated charge at about 02:24:40, two minutes after pairing.
  This matches the frozen `batPercentRemaining` reported in homebridge/homebridge#3958, but only
  on the bridge level view.

## Homebridge 2.4.0 behaviour found along the way

- `api.matter.deviceTypes` does not list SolarPower, BatteryStorage or ElectricalMeter, but
  `deviceType` accepts any matter.js endpoint type. A plugin must borrow Homebridge's own
  matter.js instance (`energy-probe/hbmatter.js`); a plugin-local copy fails with
  "is not a Behavior.Type".
- A `clusters.powerSource` with no battery attributes is composed without the `Wired` feature and
  fails conformance. It also replaces a plugin-composed wired PowerSource. Workaround: bake the
  wired PowerSource into the device type and declare 0x0011 in `descriptor.deviceTypeList`.
- Cached accessories whose type is not in `api.matter.deviceTypes` are skipped at the pre-online
  restore (`Cannot restore cached Matter accessory ... unknown device type`) and return when the
  plugin registers. Their endpoint numbers stay the same across restarts.

## What this means for the plugin

| Reading | Publish as | Why |
|---|---|---|
| Grid import/export | `ElectricalMeter`, signed power, imported and exported energy | Drives the Energy tab's whole-home figure correctly, with no double counting of PV, battery or plugs |
| Load | `OnOffOutlet` with power and energy | Tile with live watts, listed on the Energy page |
| PV | `OnOffOutlet` (tile) or negative `ElectricalSensor` (accurate sign, "All Home" sheet only) | Trade-off between visibility and semantics |
| Battery SOC | HomeKit (HAP) service, as today | Matter battery endpoints only get a "Not Supported" tile, and they put the frozen percentage on the bridge page |

The Matter 1.4 energy device types are not worth pursuing upstream for Apple Home's sake until
Apple renders them.

## Not tested

- Energy (kWh) history and totals over a longer period. The probe's energy counters ran in real
  time while power ran at 60× speed, so any history from this run is meaningless.
- Whether a bridge without a battery `PowerSource` still shows a battery on its bridge page.
- Real Sunsynk data. The cloud API was not called from the test host.
