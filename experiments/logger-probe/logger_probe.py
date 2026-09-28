#!/usr/bin/env python3
"""Identify the Sunsynk datalogger on the LAN and, if it is a Solarman
LSW-3/LSE-3, read live values over its local Modbus-over-TCP tunnel (8899).

Usage:
  python3 logger_probe.py discover            # UDP broadcast; Solarman loggers answer, E-Linter does not
  python3 logger_probe.py read <ip> <serial> [--three-phase]   (three-phase = HV map)

Needs: pip install pysolarmanv5  (read mode only)
Read-only: uses Modbus function 0x03 (read holding registers) only.
"""
import socket, sys

def discover(timeout=3.0):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(timeout)
    s.sendto(b"WIFIKIT-214028-READ", ("255.255.255.255", 48899))
    found = []
    try:
        while True:
            data, addr = s.recvfrom(1024)
            # Solarman reply: "<ip>,<mac>,<logger serial>"
            found.append((addr[0], data.decode(errors="replace").strip()))
    except socket.timeout:
        pass
    if not found:
        print("No Solarman logger answered on UDP 48899. Either an E-Linter dongle, "
              "a different subnet/VLAN, or client isolation on the WiFi.")
    for ip, reply in found:
        print(f"{ip}: {reply}")
        port_open = socket.socket(); port_open.settimeout(2)
        print(f"  TCP 8899 {'open' if port_open.connect_ex((ip, 8899)) == 0 else 'closed'}")
        port_open.close()

def s16(v): return v - 0x10000 if v & 0x8000 else v

# Register maps (holding registers, function 0x03). Single-phase map matches
# kellerza/sunsynk single_phase definitions; three-phase HV map matches its
# three_phase_hv definitions. Verify against your inverter before trusting.
# (register, scale, signed)
SINGLE = {"soc": (184, 1, False), "batt_w": (190, 1, True), "pv1_w": (186, 1, False),
          "pv2_w": (187, 1, False), "load_w": (178, 1, True), "grid_w": (169, 1, True)}
# Three-phase HV (e.g. SUN-xxK-SG01HP3): battery and PV power are in units of 10 W.
THREE = {"soc": (588, 1, False), "batt_w": (590, 10, True), "pv1_w": (672, 10, False),
         "pv2_w": (673, 10, False), "load_w": (653, 1, True), "grid_w": (625, 1, True)}

def read(ip, serial, three_phase=False):
    from pysolarmanv5 import PySolarmanV5
    m = PySolarmanV5(ip, int(serial), port=8899, mb_slave_id=1, socket_timeout=5)
    try:
        for name, (reg, scale, signed) in (THREE if three_phase else SINGLE).items():
            v = m.read_holding_registers(reg, 1)[0]
            print(f"{name:7s} reg {reg}: {(s16(v) if signed else v) * scale}")
    finally:
        m.disconnect()

if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "discover":
        discover()
    elif len(sys.argv) >= 4 and sys.argv[1] == "read":
        read(sys.argv[2], sys.argv[3], "--three-phase" in sys.argv)
    else:
        print(__doc__)
