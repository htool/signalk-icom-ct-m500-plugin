const util = require('util')
// const Speaker = require('speaker');
const regex_properties = /49636f6d01000000...............000050000d00000000/gi
const regex_update =     /49636f6d01000000...............0102000010000000....bd003000bd000205..00..000000/gi
//                                        ^-hex ip src dst - seem to be ignored
const is_rtp = require('is-rtp')
const RTPParser = require('@penggy/easy-rtp-parser');
const ip = require('ip');

var globalOptions = []

module.exports = function (app) {
  var plugin = {}
  var unsubscribes = []
  var timers = []

  plugin.id = 'signalk-ct-m500-plugin'
  plugin.name = 'ICOM CT-M500 plugin'
  plugin.description = 'Get active channel information and change channel over wlan.'

  var schema = {
    // The plugin schema
    properties: {
      ip: {
        description: 'If you use the IC-M510E plugin as well, you cannot use the same IP address for the CT-M500. You can add an IP to your wifi interface and assign here.',
        title: 'Alternative IP address to use',
        default: '',
        type: 'string'
      },
      receive: {
        title: 'Enable receiving incoming messages',
        type: 'boolean'
      },
      port: {
        description: 'To relay incoming nmea0183 messages, set the port to send it to on localhost',
        title: 'UDP port number',
        default: 10110,
        type: 'number'
      },
      receiveNMEA: {
        type: 'object',
        title: 'Filter the following NMEA0183 sentences out before passing to SignalK',
        properties: {
          GPGSV: {
            title: 'GPGSV - GNSS satellites in view',
            type: 'boolean',
            default: false
          },
          GLGSV: {
            title: 'GLGSV - GNSS satellites in view',
            type: 'boolean',
            default: false
          },
          GNRMC: {
            title: 'GNRMC - Recommended minimum specific GNSS data',
            type: 'boolean',
            default: false
          },
          GNGSA: {
            title: 'GNGSA- GPS DOP and active satellites',
            type: 'boolean',
            default: false
          },
          GPGSA: {
            title: 'GPGSA - GPS DOP and active satellites',
            type: 'boolean',
            default: false
          },
          CDFSI: {
            title: 'CDFSI - Set VHF transmit and receive channel',
            type: 'boolean',
            default: false
          }
        }
      }
    }
  }

  function sendN2k(msgs) {
    app.debug("n2k_msg: " + msgs)
    msgs.map(function(msg) { app.emit('nmea2000out', msg)})
  }

  plugin.schema = function() {
    return schema
  }

  plugin.start = function (options, restartPlugin) {
    // Here we put our plugin logic
    app.debug('Plugin started')
		var udp = require('dgram')
    var myIP = options.ip || ip.address()
    app.debug('Using IP: ' + myIP)
    var myIPHex = ip2hex(myIP)
    var radioIPhex = "unlikely"
    var radioPorthex = "unlikely"
    var broadcastIP = '255.255.255.255'
    var broadcastIPHex = ip2hex(broadcastIP)
    var icomHex = "49636f6d"
    var RS_M500Hex = "52532d4d353030"
    var CT_M500Hex = "43542d4d353030"
    var IC_M510Hex = "49432d4d353130"
    var portAhex = "unlikely"
    var portBhex = "unlikely"
    var portChex = "unlikely"
    var portDhex = "unlikely"
    var portEhex = "unlikely"
    var portVoicehex = "unlikely"
		var serverA = udp.createSocket('udp4');
		var serverB = udp.createSocket('udp4');
		var serverC = udp.createSocket('udp4');
		var serverD = udp.createSocket('udp4');
		var serverVoice = udp.createSocket('udp4');
		var serverE = udp.createSocket('udp4');
		var modeArray = ['00', '10', '20']
		var radio = {busy: false, status: "offline"}
		var findRadioTimer
		var keepAliveTimer = false
    var scanTimer
		var listenPortA 
		var listenPortB 
		var listenPortC 
		var listenPortD 
		var listenPortE 
		var listenPortVoice
		var channelTable = {'requested': false}
		var channelTableNr = 0
		var channelMode = '00'
		var propertiesHex
		var activeChannelObj = {}
		var header
    var horn = false
    var startSilence
    var onlineTimestamp = Date.now()
    var online = false
    let onStop = []
    var nmeaTypes = []
    var silence = 0


    app.debug ('options: %j', options)


    // let eventsString = 'myNMEA0183OutputEvent'
    let eventsString = 'nmea0183out'
    let events = eventsString.split(',').map(s => s.trim())
    app.debug(`using events %j`, events)
    events.forEach(name => {
      app.on(name, sendNMEA0183)
    })
    onStop.push(() => {
      events.forEach(name => {
        app.signalk.removeListener(name, send)
      })
    })

    function testSend () {
      app.debug('sendNMEA0183 DSC')
      // $AIDSC,DSC Message Type,MMSI Number,Category,First Telecommand,Second Telecommand,VHF Channel,Time ,MMSI of Ship in Distress ,Nature of Distress ,Acknowledge Flag,Expansion Indicator*25

      sendNMEA0183('$CDDSC,20,244670681,00,00,26,900072900072,,,,,R*17')
      sendNMEA0183('$CDDSC,20,0244670681,00,00,26,900072900072,,,,,R*27')
      sendNMEA0183('$CDDSC,20,00244670681,00,00,26,900072900072,,,,,R*17')
      // sendNMEA0183('$CDDSE,1,1,A,1228877760,00,12005590*1E')
      sendNMEA0183('$AIDSC,20,244670681,00,00,26,900072900072,,,,,R*18')
      sendNMEA0183('$AIDSC,20,0244670681,00,00,26,900072900072,,,,,R*28')
      sendNMEA0183('$AIDSC,20,00244670681,00,00,26,900072900072,,,,,R*18')
      sendNMEA0183('$CDDSC,20,00244670681,00,00,26,900069900069,,,,R,*2C')
      sendNMEA0183('$CDDSC,20,0244670681,00,00,26,900069900069,,,,R,*3C')
      sendNMEA0183('$CDDSC,20,244670681,00,00,26,900069900069,,,,R,*0C')
    }


    async function sendNMEA0183 (string) {
      if (radio.status == 'online' && !string.match(/aN/)) {
        let length = string.length + 2   // 0d0a
        let header = [73,99,111,109,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,length,0,0,0,1,length,2]
        let msg_header = Buffer.from(header)
        let msg_nmea = Buffer.from(string, 'utf-8')
        let msg_array = [msg_header, msg_nmea, Buffer.from('0d0a', 'hex')]
        let msg = Buffer.concat(msg_array)
        serverD.send(msg, 0, msg.length, 50004, radio.ip, function() {
          // app.debug('sendNMEA0183 AIS')
		    })
      }
    }

    setTimeout(() => { testSend() }, 25000)
      
    function ip2hex (ip) {
      var hex = []
      ip.split('.').forEach(n => {
        hex.push(("00" + parseInt(n).toString(16).toLowerCase()).substr(-2,2))
      })
      return hex[3]+hex[2]+hex[1]+hex[0]
    }
	
    /*
		// Create the Speaker instance
		const speaker = new Speaker({
		  channels: 1,          // 2 channels
		  bitDepth: 16,         // 16-bit samples
		  sampleRate: 8000     // 8000 Hz sample rate
		})
    */
		
		
		serverA.on('message',function(msg,info){
		  if (!findRadioTimer._destroyed) {
		    clearInterval(findRadioTimer)
		    radio.ip = info.address
        radioIPhex = ip2hex(radio.ip)
        app.debug('radioIPhex: ' + radioIPhex)
		    radio.port = info.port
        radioPorthex = port2hex(radio.port)
		    // app.debug('Received ServerA packet')
		    // app.debug(msg.toString('hex') + " " + msg.toString('utf-8'))
		    header = msg.slice(0,17)
		    debugPrint('Header ', header)
        radio.status = 'Initializing CT-M500'
        // sendRadio(radio)
		    sendSignIn('CT-M500', radio.ip, radio.port, listenPortB, listenPortC, listenPortD, listenPortE, listenPortVoice)
		  } else {
		    debugPrint('ServerA', msg)
		    // app.debug(msg.slice(0,48).toString('hex') + ' [' + msg.length + ']');
		    // app.debug('Received %d bytes from %s:%d\n',msg.length, info.address, info.port);
		  }
		})
		
		serverB.on('message',function(msg,info) {
      onlineTimestamp = Date.now()
		  let msgString = msg.toString('hex')
      if (!msgString.startsWith('80c9000')) {
        debugPrint('ServerB', msg)
      }
		  if (!keepAliveTimer) {
		    app.debug('Starting keepalive')
		    keepAliveTimer = setInterval(() => keepAlive(info.address, info.port), 5000)
		  }
		  if (channelTable.requested == false) {
		    setTimeout(() => askChannel(), 4000)
		  }
		  debugPrint('ServerB', msg)
		})

		serverC.on('message',function(msg,info) {
      onlineTimestamp = Date.now()
		  const hex = Array.from(msg)
		  let msgString = msg.toString('hex')
		  if (msg.length == 28) {
		    app.debug('ServerC ACK (' + info.address + ':' + info.port + '): [' + msg.length + '] ' + msg.toString('hex'))
		  } else if (msgString.match(regex_update)) {
		    readChannelUpdate(msg)
		  } else if (msg.length == 32) {
        debugPrint("serverC hailer/horn: ", msg)
        if (hex[24] == 4) {
          let rxVolume = hex[31]
          app.debug('RX volume: ' + rxVolume)
        } else if (hex[24] == 2) {
          let hornVolume = hex[29]
          let hz = Number(hex[28]) * 10
          if (hex[26] == 80) {
            app.debug('HORN is on. Horn volume: ' + hornVolume + ' Hz: ' + hz)
            horn = true
          } else if (hex[26] == 64) {
            app.debug('HORN is off. Horn volume: ' + hornVolume + ' Hz: ' + hz)
            horn = false
          }
        } else if (hex[24] == 1) {
          let hailerVolume = hex[30]
          app.debug('Hailer volume: ' + hailerVolume)
        }
		  } else if (msg.length < 35) {
        debugPrint("serverC <35", msg)
		  } else {
		    let s = parseInt(hex[35].toString(16),16)
		    switch (s) {
		      case 128:
            if (radio.busy == false) {
		          radio.busy = true
            }
		        break
		      case 0:
            if (radio.busy == true) {
		          radio.busy = false
              startSilence = Date.now()
            }
		        break
		    }
		    debugPrint('ServerC ', msg)
        radio.status = 'online'
        activeChannelObj = JSON.parse(JSON.stringify(getChannel(hex)))
		  } 
		  app.debug("activeChannelObj:  " + JSON.stringify(activeChannelObj))
      sendRadio()
      sendChannel()
		})

		serverE.on('message', function(msg,info) {
		  // app.debug('ServerE ACK (' + info.address + ':' + info.port + '): [' + msg.length + '] ' + msg.toString('hex'))
		  // app.debug('ServerE ACK', msg)
      receiveNMEA0183(msg)
		})

		function readChannelUpdate (msg) {
		  const hex = Array.from(msg)
		  app.debug(hex.join(' '))
		  app.debug('readChannelUpdate')
		  radio.squelch = hex[34]
		  switch (hex[35]) {
		    case 3:
		      activeChannelObj.watt = 1
		      activeChannelObj.hilo = false
		      break
		    case 7:
		      activeChannelObj.watt = 1
		      activeChannelObj.hilo = true
		      break
		    case 15:
		      activeChannelObj.watt = 25
		      activeChannelObj.hilo = true
		      break
		  }
		  if (typeof activeChannelObj.nr != 'undefined') {
		    channelTable[activeChannelObj.nr][activeChannelObj.mode].watt = activeChannelObj.watt
		    app.debug(activeChannelObj)
		  }
		}
		
		serverVoice.on('message',function(msg,info) {
		  const hex = Array.from(msg)
		  debugPrint('ServerVoice', msg)
		  // msg.pipe(speaker)
		})
		
    function stringToN (string) {
      if (string.length == 4) {
        let r = modeArray.indexOf(string.substr(-4,2))
        let n = parseInt(string.substr(-2,2), 10)
        return n*3 + r
      } else if (string.length <= 2) {
        let n = parseInt(string, 10)
        return n*3
      }
    }

		function getChannelInfoN (n) {
		  let r = n % 3
		  let nr = Math.floor(n / 3)
		  var mode = modeArray[r]
		  var info = {nr: nr, mode: mode}
		  if (typeof channelTable[nr] != 'undefined'){
		    info.name = channelTable[nr][mode].name
		    info.fav = channelTable[nr][mode].fav
		    info.watt = channelTable[nr][mode].watt
		    info.duplex = channelTable[nr][mode].duplex
		    info.enabled = channelTable[nr][mode].enabled
		  }
		  return info
		}
		
		function getChannelInfoHex (hex1, hex2) {
		  let n = (parseInt(hex1.toString(16),16) * 256) + parseInt(hex2.toString(16),16)
		  return getChannelInfoN(n)
		}
		
		function getChannel (hex) {
		  // app.debug('getChannel: ' + hex.join(' '))
		  let channel = getChannelInfoHex(hex[27], hex[26])
		  radio.squelch = hex[34]
		  // app.debug('getChannel channel: ' + JSON.stringify(channel))
		  let w = hex[36] % 16
		  // app.debug('w: ' + w)
		  switch (w) {
		    case 3:
		      channel.watt = 1
		      channel.hilo = false
		      break
		    case 7:
		      channel.watt = 1
		      channel.hilo = true
		      break
		    case 11:
		      channel.watt = 1
		      channel.hilo = true
		      break
		    case 15:
		      channel.watt = 25
		      channel.hilo = true
		      break
		  }
      startSilence = Date.now()
		  return channel
		}
		
		serverD.on('message',function(msg,info) {
		  const hex = Array.from(msg)
		  let msgString = msg.toString('hex')
		  // app.debug('ServerD:\n' + msg.toString('hex') + "\n" + msg.toString('utf-8'))
		  if (msgString.startsWith('49636f6d01000000000000000000000000010000')) {
		    app.debug('ServerD (' + info.address + ':' + info.port + '): ' + msgString)
        receiveNMEA0183(msg)
		  } else {
        debugPrint('ServerD', msg)
		  }
		})

    function receiveNMEA0183 (msg) {
      //app.debug('receiveNMEA0183: [' + msg.length + '] ' + msg.toString('hex'))
      let h = Array.from(msg.slice(0,27))
      // app.debug('NMEA0183: ' + h)
      let length = h[20]
      msg = msg.slice(27)
      // app.debug('receiveNMEA0183: [' + length + '] ' + msg.toString('utf-8'))
      var msgString = msg.toString('utf-8').trim()
      let nmeaType = msgString.split(',')[0].replace('$','')
      if (nmeaTypes.indexOf(nmeaType) < 0) {
        nmeaTypes.push(nmeaType)
        app.debug('NMEA0183: [' + length + '] ' + msg.toString('utf-8'))
        app.debug('nmeaTypes: ' + nmeaTypes.join(','))
      }
      if (typeof options.receiveNMEA[nmeaType] != 'undefined') {
        if (options.receiveNMEA[nmeaType] == false) {
          // app.debug('NMEA0183 receive ' + nmeaType + " " + options.receiveNMEA[nmeaType] + " " + msgString)
          // app.emit('nmea0183out', msgString)
      		if (options.receive == 'true') {
            serverA.send(msg, 0, msg.length, options.port, '127.0.0.1', function () {})
          }
        } 
      }
    }
		
		function hex2bin(hex){
		    return ("00000000" + (parseInt(hex, 16)).toString(2)).substr(-8);
		}
		
		serverA.on('error',function(error){
		  app.debug('Error: ' + error);
		  serverA.close();
		})

		serverB.on('error',function(error){
		  app.debug('Error: ' + error);
		  serverB.close();
		})

		serverC.on('error',function(error){
		  app.debug('Error: ' + error);
		  serverC.close();
		})

		serverD.on('error',function(error){
		  app.debug('Error: ' + error);
		  serverD.close();
		})

		serverA.bind({
      address: myIP
    }, function() {
		  serverA.setBroadcast(true);
		  const address = serverA.address()
		  app.debug("Client using portA " + address.port)
		  listenPortA = address.port
      portAhex = port2hex(portAhex)
		  findRadioTimer = setInterval(broadcastNew, 1000);
		})

		serverB.bind({
      address: myIP
    }, function() {
		  const address = serverB.address()
		  app.debug("Client using portB " + address.port)
		  listenPortB = address.port
		})

		serverC.bind({
      address: myIP
    }, function() {
		  const address = serverC.address()
		  app.debug("Client using portC " + address.port)
		  listenPortC = address.port
		})

		serverD.bind({
      address: myIP
    }, function() {
		  const address = serverD.address()
		  app.debug("Client using portD " + address.port)
		  listenPortD = address.port
		})

		serverE.bind({
      address: myIP
    }, function() {
		  const address = serverE.address()
		  app.debug("Client using portE " + address.port)
		  listenPortE = address.port
		})

		serverVoice.bind({
      address: myIP
    }, function() {
		  const address = serverD.address()
		  app.debug("Client using voice port " + address.port)
		  listenPortVoice = address.port
		})

		function broadcastNew() {
		  var hex = listenPortA.toString(16)
		  hex = hex[2]+hex[3]+hex[0]+hex[1]
		  var broadcastMsg = Buffer.from(icomHex + "01ff0000" + myIPHex + broadcastIPHex + "0000000004000000" + hex + "0000", "hex")
		  serverA.send(broadcastMsg, 0, broadcastMsg.length, 50000, broadcastIP, function() {
		    debugPrint("Broadbast sent ", broadcastMsg);
		  })
		}

		function keepAlive (ip, port) {
		  var keepAliveMsg = Buffer.from("8001004", "hex")
		  serverB.send(keepAliveMsg, 0, keepAliveMsg.length, port, ip, function() {
		    // app.debug("Sent keepalive")
		  })
		}
		
    function port2hex (port) {
		  var porthex = port.toString(16).toLowerCase()
		  return porthex[2]+porthex[3]+porthex[0]+porthex[1]
    }

		function sendSignIn (type, ip, port, portB, portC, portD, portE, portVoice) {
		  portBhex = port2hex(portB)
		  portChex = port2hex(portC)
		  portDhex = port2hex(portD)
		  portEhex = port2hex(portE)
		  portVoicehex = port2hex(portVoice)
      var signIn = Buffer.from(icomHex + "01ff0000" + myIPHex + ip2hex(radio.ip) + "00020000380000000100" + portDhex + portVoicehex + portBhex + portChex + portEhex + CT_M500Hex + "00000042134195000000000000000000000000000000000000000000000000000000000000", "hex")
      status = 'Initializing CT-M500'
		  serverA.send(signIn, 0, signIn.length, port, ip, function() {
		    debugPrint("Sending SignIn", signIn)
		  })
		}

		function changeChannelTo (n) {
		  let nr = Math.floor(n / 3)
		  let r = n % 3
      let mode = modeArray[r]
      if (typeof channelTable[nr] != 'undefined') {
        if (typeof channelTable[nr][mode] != 'undefined') {
          if (typeof channelTable[nr][mode].enabled != 'undefined') {
            if (channelTable[nr][mode].enabled == true) {
      		    //49 63 6f 6d 01 02 00 00 ca 01 a8 c0 99 01 a8 c0 01 00 00 00 08 00 00 00 03 00 00 00 01 00 1e 00
      		    //49 63 6f 6d 01 02 00 00 ca 01 a8 c0 99 01 a8 c0 01 00 00 00 08 00 00 00 02 00 00 00 01 00 21 00
      		    let chHex = ('0000'+(n).toString(16)).substr(-4)
      		    chHex = chHex[2] + chHex[3] + chHex[0] + chHex[1]
      		    msg = Buffer.from(icomHex + "01020000" + myIPHex + ip2hex(radio.ip) + "0100000008000000030000000100" + chHex, "hex")
      		    serverC.send(msg, 0, msg.length, 50003, radio.ip, function () {
      		      // app.debug('Change channel: n: ' + n + ' hex: ' + chHex + '  ' + msg.toString('hex'))
      		      activeChannelObj = JSON.parse(JSON.stringify(getChannelInfoN(n)))
      		    })
		          app.debug("changeChannelTo: activeChannelObj:  " + JSON.stringify(activeChannelObj))
              return true
            } else {
		          app.debug("changeChannelTo: not enabled")
              return false
            }
          } else {
		        app.debug("changeChannelTo: enabled not defined")
          }
        } else {
		      app.debug("changeChannelTo: mode not defined")
        }
      } else {
		    app.debug("changeChannelTo: tableChannel[nr] not defined")
      }
      startSilence = Date.now()
		}
		
		function changeChannelUpDown (channelObj, direction, favOnly) {
		  app.debug("changeChannelUpDown")
		  // app.debug(channelObj)
		  var n = (channelObj.nr * 3) + modeArray.indexOf(channelObj.mode)
		  var nr, r, enabled, fav, match, lookupWorks
		  do {
		    if (n > 88*3) { 
          n = 2 
        } else if (n < 2) {
          n = 88*3+1
        }
		    lookupWorks = false
		    enabled = false
        fav = false
		    n = n + direction
		    r = n % 3
		    nr = Math.floor(n / 3)
        mode = modeArray[r]
		    if (typeof channelTable[nr] != 'undefined') {
          if (typeof channelTable[nr][mode] != 'undefined') {
            if (typeof channelTable[nr][mode].enabled != 'undefined') {
		          enabled = channelTable[nr][mode].enabled
		          if (typeof channelTable[nr][mode].fav != 'undefined') {
                fav = channelTable[nr][mode].fav
		            lookupWorks = true
              }
            }
          }
		    }
		    app.debug('Finding next channel: favOnly: ' + JSON.stringify(favOnly) + ' nr: ' + nr + ' mode: ' + modeArray[r] + ' enabled: ' + enabled + ' fav: ' + fav + ' lookupWorks: ' + lookupWorks)
		    if (favOnly == true && lookupWorks == true && fav == true && enabled == true ) {
		      match = true
		    } else if (favOnly == false && lookupWorks == true && enabled == true ) {
		      match = true
        } else {
		      match = false
		    }
		  } while (match == false)
		  if (lookupWorks) {
		    // app.debug('Next channel: ' + nr + ' ' + modeArray[r])
		    return(changeChannelTo(n))
		  } else {
		    app.debug("Can't lookup yet")
		  }
		}
		
		function askChannel () {
      // var msg = Buffer.from(icomHex + "01020000" + myIPHex + ip2hex(radio.ip) + "0103000000000000", "hex")
      var msg = Buffer.from(icomHex + "01000000" + myIPHex + ip2hex(radio.ip) + "0103000000000000", "hex")
		  serverC.send(msg, 0, msg.length, 50003, radio.ip, function () {
		    // app.debug("Sending askChannel")
		  })
		}

		function scanUp (favOnly) {
		  // app.debug('activeChannelObj: ' + JSON.stringify(activeChannelObj))
		  if (!radio.busy && favOnly != -1) {
		    changeChannelUpDown(activeChannelObj, 1, favOnly)
		    scanTimer = setTimeout(() => scanUp(favOnly), 200)
		  }
		}

		function squelch (level) {
		  // icomHex + "010000009101a8c01901a8c001020000100000000203bd003000bd000205050007000000
		  // icomHex + "010000009101a8c01901a8c001020000100000000203bd003000bd000205010007000000
		  let levelHex = ("00" + level.toString(16)).substr(-2);
		  var msg = Buffer.from(icomHex + "01000000" + myIPHex + ip2hex(radio.ip) + "01020000100000000203bd003000bd000205" + levelHex + "0007000000", "hex")
		  serverC.send(msg, 0, msg.length, 50003, radio.ip, function () {
		    app.debug("Sending squelch msg " + msg.toString('hex'))
		  })
		}

    function sendRadio () {
      app.debug('sendRadio: ' + JSON.stringify(radio))
      var values = []
      var path = 'communication.vhf'
      if (typeof radio.ip != 'undefined') {
        values.push({path: path + '.ip', value: radio.ip})
        values.push({path: path + '.port', value: radio.port})
      }
      if (typeof radio.status != 'undefined') {
        values.push({path: path + '.status', value: radio.status})
      }
      if (typeof radio.busy != 'undefined') {
        values.push({path: path + '.busy', value: radio.busy})
      }
      app.handleMessage(plugin.id, {
        updates: [
          {
            values: values
          }
        ]
      })
    }

    function channelN() {
      if (typeof activeChannelObj.nr != 'undefined') {
        if (typeof activeChannelObj.mode != 'undefined') {
          return (parseInt(activeChannelObj.nr, 10) * 3 + modeArray.indexOf(activeChannel.mode))
        }
      }
    }

    function channelString() {
      if (typeof activeChannelObj.nr != 'undefined') {
        if (typeof activeChannelObj.mode != 'undefined') {
          if (activeChannelObj.mode == "00") {
            return activeChannelObj.nr.toString()
          } else {
            return activeChannelObj.mode + ("00" + activeChannelObj.nr.toString()).substr(-2)
          }
        }
      } else {
        return ""
      }
    }


    function debugPrint (name, msg) {
      let re_myIPHex = new RegExp(myIPHex, "g")
      let re_broadcastIPHex = new RegExp(broadcastIPHex, "g")
      let re_icomHex = new RegExp(icomHex, "g")
      let re_RS_M500Hex = new RegExp(RS_M500Hex, "g")
      let re_CT_M500Hex = new RegExp(CT_M500Hex, "g")
      let re_IC_M510Hex = new RegExp(IC_M510Hex, "g")
      let re_portBhex = new RegExp(portBhex, "g")
      let re_portChex = new RegExp(portChex, "g")
      let re_portDhex = new RegExp(portDhex, "g")
      let re_portVoicehex = new RegExp(portVoicehex, "g")
      let re_portEhex = new RegExp(portEhex, "g")
      let re_radioIPhex = new RegExp(radioIPhex, "g")
      let re_radioPorthex = new RegExp(radioPorthex, "g")

      hexString = msg.toString('hex').toLowerCase()
                  .replace(re_myIPHex, '- myIP -')
                  .replace(re_broadcastIPHex, '- BCST -')
                  .replace(re_icomHex, 'Icom')
                  .replace(re_RS_M500Hex, 'RS-M500')
                  .replace(re_CT_M500Hex, 'CT-M500')
                  .replace(re_IC_M510Hex, 'IC-M510')
                  .replace(re_portBhex, '-pB-')
                  .replace(re_portChex, '-pC-')
                  .replace(re_portDhex, '-pD-')
                  .replace(re_portVoicehex, '-pV-')
                  .replace(re_portEhex, '-pE-')
                  .replace(re_radioIPhex, '-radoIP-')
                  .replace(re_radioPorthex, '-rP-')
                  .replace(/ / , '__')
      app.debug(name + ': [' + msg.length + '] ' + hexString)
    }

    function sendChannel () {
      app.debug('sendChannel: ' + JSON.stringify(activeChannelObj))
      var values = []
      var path = 'communication.vhf'
      values.push({path: path + '.channel', value: channelString()})
      if (typeof activeChannelObj.watt != 'undefined') {
        values.push({path: path + '.watt', value: activeChannelObj.watt})
      }
      app.handleMessage(plugin.id, {
        updates: [
          {
            values: values
          }
        ]
      })
    }

	};

  plugin.stop = function () {
    // Here we put logic we need when the plugin stops
    app.debug('Plugin stopped')
    unsubscribes.forEach(f => f())
    unsubscribes = []
    timers.forEach(timer => {
      clearInterval(timer)
    }) 
  }

  return plugin;
};

function intToHex(integer) {
	var hex = padd((integer & 0xff).toString(16), 2)
  return hex
}

function padd(n, p, c)
{
  var pad_char = typeof c !== 'undefined' ? c : '0';
  var pad = new Array(1 + p).join(pad_char);
  return (pad + n).slice(-pad.length);
}

