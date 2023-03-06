## Icom IC-M500 plugin

The plugin reads `nmea0183out` and relays this info to the IC-M510E.
This enables a non-AIS model to still show AIS targets on the display.

To enable nmea0183out, install:
 - https://www.npmjs.com/package/@signalk/signalk-to-nmea0183

To enable the sending of AIS messages to nmea0183, install:
 - https://www.npmjs.com/package/signalk-n2kais-to-nmea0183

## Plugin config

The config allows you to filter out nmea0183 messages coming from the IC-M510E.
To receive the messages, you need to add a nmea0183 UDP listener connection in SignalK's connections and configure the port number.

## SignalK info
Radio info is written to:
```
communication.vhf.ip        string      IP address of Icom M510E
                 .port      number      UDP source port
                 .busy      boolean     Is channel busy?
                 .channel   string      Active channel
                 .hilo      boolean     Allows changing High/Low?
                 .watt      number      1 or 25 Watt
```
