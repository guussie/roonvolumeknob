For the full description of this application head to the Wiki.

This application allows for the use of a Fosi Audio VOL20 Bluetooth Volume Kno to be used to control the volume of a Roon Zone.

Hardware requirements:
  - Raspberry Pi 4 with micro SD card (32GB to be sure)
  - Fosi Audio VOL20 Volume Knob

At this point, the application works pretty well. Features are:

  - Volume control of a Roon Zone. The Roon Zone can be selected in a web interface
  - Play/Pause side button works
  - After the knob has been switched off or is recharged, the VOL20 device reconnects with the Raspberry Pi automatically
  - The web interface also shows the battery charge level
  - The Play/Pause button can be controlled through a web hook
  - The battery control is also visible as a humidity sensor through a web hook
  - The web hooks can be integrated with Homebridge/Homekit
  - In Homekit you can set an alert when the battery level goes down to a certain level

To mak ethe applicationwork, a number of settings still need to be entered manually in the code. This includes:

- Setting startup volume level
- MAC Address of the VOL20 device (on an Apple Mac, the MAC address can be found by pairing the VOL20 knob with a Mac, then finding the MAC Address in the System Report)
- IP address of your HomeBridge server

The objective os to fine-tune the code so that entering these settings is made easier and can ultimately be done through the web interface.
But since these settings don't change often or never at all, this is not a priority for the moment.

