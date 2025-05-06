const RoonApi = require("node-roon-api");
const RoonApiStatus = require("node-roon-api-status");
const RoonApiTransport = require("node-roon-api-transport");
const express = require('express');
const bodyParser = require('body-parser');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

// Configuration files
const CONFIG_FILE = path.join(__dirname, 'config.json');
const WEBHOOK_CONFIG_FILE = path.join(__dirname, 'webhook-config.json');

// Global variables
let roon = null;
let roonCore = null;
let transport = null;
let zoneList = {};
let selectedZone = null;
let selectedOutput = null;
let currentVolume = 5;
let initialVolumeSet = false;
let webhookUrl = null;
let bluetoothConfig = {
    deviceName: "VOL20",
    macAddress: "XX:XX:XX:XX:XX:XX", // Use the MAC address shown in your logs
    startupVolume: 5
};
let deviceBatteryInfo = {
    level: null,
    lastUpdated: null
};
let homebridgeConfig = {
    enabled: false,
    url: 'http://xxx.xxx.xxx.xxx:51828',
    accessoryId: 'vol20_dining_battery',
    deviceName: 'VOL20-Dining'  //Add a device identifier
};

// Function to save configuration
function saveConfig() {
    const config = {
        selectedZone: selectedZone,
        lastUpdated: new Date().toISOString()
    };
    
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log("Configuration saved");
    } catch (err) {
        console.error("Error saving configuration:", err);
    }
}

// Function to load configuration
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
            const config = JSON.parse(configData);
            
            if (config.selectedZone) {
                selectedZone = config.selectedZone;
                console.log("Loaded saved zone:", selectedZone);
                // Note: we'll validate this zone exists later when zones are loaded
            }
        } else {
            console.log("No saved configuration found");
        }
    } catch (err) {
        console.error("Error loading configuration:", err);
    }
}

// Function to save webhook configuration
function saveWebhookConfig() {
    const config = {
        webhookUrl: webhookUrl,
        lastUpdated: new Date().toISOString()
    };
    
    try {
        fs.writeFileSync(WEBHOOK_CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log("Webhook configuration saved");
    } catch (err) {
        console.error("Error saving webhook configuration:", err);
    }
}

// Function to load webhook configuration
function loadWebhookConfig() {
    try {
        if (fs.existsSync(WEBHOOK_CONFIG_FILE)) {
            const configData = fs.readFileSync(WEBHOOK_CONFIG_FILE, 'utf8');
            const config = JSON.parse(configData);
            
            if (config.webhookUrl) {
                webhookUrl = config.webhookUrl;
                console.log("Loaded webhook URL:", webhookUrl);
            }
        } else {
            console.log("No webhook configuration found");
        }
    } catch (err) {
        console.error("Error loading webhook configuration:", err);
    }
}

// Function to save Homebridge configuration
function saveHomebridgeConfig() {
    const config = {
        homebridgeConfig: homebridgeConfig,
        lastUpdated: new Date().toISOString()
    };
    
    try {
        fs.writeFileSync(path.join(__dirname, 'homebridge-config.json'), JSON.stringify(config, null, 2));
        console.log("Homebridge configuration saved");
    } catch (err) {
        console.error("Error saving Homebridge configuration:", err);
    }
}

// Function to load Homebridge configuration
function loadHomebridgeConfig() {
    try {
        const configFile = path.join(__dirname, 'homebridge-config.json');
        if (fs.existsSync(configFile)) {
            const configData = fs.readFileSync(configFile, 'utf8');
            const config = JSON.parse(configData);
            
            if (config.homebridgeConfig) {
                homebridgeConfig = {
                    ...homebridgeConfig, // Keep defaults
                    ...config.homebridgeConfig // Override with saved values
                };
                console.log("Loaded Homebridge configuration:", homebridgeConfig);
            }
        } else {
            console.log("No Homebridge configuration found");
        }
    } catch (err) {
        console.error("Error loading Homebridge configuration:", err);
    }
}

// Function to find the VOL20 device
function findVOL20Device() {
    return new Promise((resolve, reject) => {
        // First check if the Bluetooth device is connected
        exec('bluetoothctl devices | grep -i "VOL20"', (error, stdout, stderr) => {
            console.log("Checking bluetooth devices...");
            
            if (!error && stdout.trim()) {
                const btDeviceMatch = stdout.match(/([0-9A-F:]{17})\s+VOL20/i);
                if (btDeviceMatch) {
                    const btAddress = btDeviceMatch[1];
                    console.log(`Found VOL20 with address: ${btAddress}`);
                    
                    // Check if the device is connected
                    exec(`bluetoothctl info ${btAddress} | grep "Connected: yes"`, (err, out) => {
                        if (!err && out.includes("Connected: yes")) {
                            console.log("VOL20 is connected");
                            
                            // Now let's find the input device by checking each event device
                            exec('ls -l /dev/input/event*', (err2, out2) => {
                                if (!err2) {
                                    // Get list of event devices
                                    const eventDevs = out2.match(/event\d+/g);
                                    if (eventDevs && eventDevs.length > 0) {
                                        console.log(`Found ${eventDevs.length} event devices. Checking each one for VOL20...`);
                                        
                                        // Check each event device sequentially
                                        findVOL20EventDevice(eventDevs, 0)
                                            .then(eventDevice => {
                                                if (eventDevice) {
                                                    console.log(`Found VOL20 at ${eventDevice}`);
                                                    resolve(`/dev/input/${eventDevice}`);
                                                } else {
                                                    console.log("Could not find VOL20 among event devices. Using fallback.");
                                                    resolve('/dev/input/event0');
                                                }
                                            })
                                            .catch(e => {
                                                console.error("Error finding VOL20 event device:", e);
                                                resolve('/dev/input/event0');
                                            });
                                        return;
                                    }
                                }
                                
                                // Fallback to a hardcoded device
                                console.log("Could not list event devices. Using fallback.");
                                resolve('/dev/input/event0');
                            });
                        } else {
                            console.log("VOL20 is not connected. Please check your Bluetooth connection.");
                            // Fallback to a default device
                            resolve('/dev/input/event0');
                        }
                    });
                } else {
                    console.log("VOL20 device not found in bluetoothctl devices list");
                    resolve('/dev/input/event0');
                }
            } else {
                console.log("Error listing Bluetooth devices or VOL20 not found");
                resolve('/dev/input/event0');
            }
        });
    });
}

// Helper function to check each event device for VOL20
function findVOL20EventDevice(eventDevs, index) {
    return new Promise((resolve, reject) => {
        if (index >= eventDevs.length) {
            // We've checked all devices and didn't find VOL20
            resolve(null);
            return;
        }

        const eventDevice = eventDevs[index];
        console.log(`Checking ${eventDevice}...`);
        
        // Run evtest and capture the initial output which contains device info
        const devicePath = `/dev/input/${eventDevice}`;
        const process = spawn('timeout', ['1', 'evtest', devicePath]);
        let output = '';
        
        process.stdout.on('data', (data) => {
            output += data.toString();
            // Once we have some output, kill the process
            if (output.length > 0) {
                process.kill();
            }
        });
        
        process.stderr.on('data', (data) => {
            console.log(`Info from ${eventDevice}: ${data}`);
        });
        
        process.on('close', (code) => {
            // Check if the output contains "VOL20"
            if (output.includes('VOL20')) {
                console.log(`Found VOL20 in ${eventDevice}`);
                resolve(eventDevice);
            } else {
                // Try with a direct grep approach as a backup
                exec(`sudo evtest ${devicePath} | grep -i "VOL20"`, { timeout: 1000 }, (err, stdout) => {
                    if (!err && stdout.includes('VOL20')) {
                        console.log(`Found VOL20 in ${eventDevice} with grep`);
                        resolve(eventDevice);
                    } else {
                        // Check next device
                        findVOL20EventDevice(eventDevs, index + 1)
                            .then(resolve)
                            .catch(reject);
                    }
                });
            }
        });
        
        // Handle error in case evtest fails
        process.on('error', (err) => {
            console.error(`Error running evtest on ${eventDevice}:`, err);
            // Continue to next device
            findVOL20EventDevice(eventDevs, index + 1)
                .then(resolve)
                .catch(reject);
        });
    });
}// Function to check if evtest is installed
function checkEvtestInstalled() {
    return new Promise((resolve) => {
        exec('which evtest', (error, stdout) => {
            if (error || !stdout.trim()) {
                console.log("evtest not found, attempting to install it...");
                exec('sudo apt-get update && sudo apt-get install -y evtest', (err) => {
                    if (err) {
                        console.error("Error installing evtest:", err);
                        resolve(false);
                    } else {
                        console.log("evtest installed successfully");
                        resolve(true);
                    }
                });
            } else {
                console.log("evtest is already installed at:", stdout.trim());
                resolve(true);
            }
        });
    });
}

// Function to trigger webhook
function triggerWebhook(action) {
    if (!webhookUrl) {
        return; // No webhook configured
    }
    
    try {
        // We'll use the 'http' or 'https' module based on the URL
        const url = new URL(webhookUrl);
        const httpModule = url.protocol === 'https:' ? https : http;
        
        // Prepare the request data
        const data = JSON.stringify({
            action: action,
            timestamp: new Date().toISOString(),
            zone: selectedZone && zoneList[selectedZone] ? zoneList[selectedZone].display_name : 'None'
        });
        
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };
        
        console.log(`Triggering webhook for ${action}:`, webhookUrl);
        
        const req = httpModule.request(options, (res) => {
            console.log(`Webhook response status: ${res.statusCode}`);
        });
        
        req.on('error', (error) => {
            console.error('Error triggering webhook:', error);
        });
        
        req.write(data);
        req.end();
    } catch (err) {
        console.error('Error triggering webhook:', err);
    }
}

// Create the Roon API instance
roon = new RoonApi({
    extension_id: "com.roonvolume.bluetooth",
    display_name: "Bluetooth Volume Control",
    display_version: "1.0.0",
    publisher: "Roon Volume Control",
    email: "your@email.com",
    
    core_paired: function(core) {
        console.log("Core paired:", core.display_name);
        roonCore = core;
        transport = core.services.RoonApiTransport;
        
        // Get zones
        transport.subscribe_zones((response, body) => {
            if (response === "Subscribed") {
                if (body.zones) {
                    zoneList = {};
                    body.zones.forEach(zone => {
                        zoneList[zone.zone_id] = {
                            display_name: zone.display_name,
                            outputs: zone.outputs || [],
                            state: zone.state || "unknown"
                        };
                    });
                    console.log("Available zones loaded");
                    
                    // Check if the selected zone still exists, if not, clear it
                    if (selectedZone && !zoneList[selectedZone]) {
                        console.log(`Previously selected zone ${selectedZone} no longer exists. Clearing selection.`);
                        selectedZone = null;
                        selectedOutput = null;
                        saveConfig(); // Save the cleared configuration
                    }
                    
                    // If we have a selected zone, update its output info
                    updateSelectedZoneOutput();
                }
            } else if (response === "Changed" && body.zones_changed) {
                // Update zones info when changes occur
                body.zones_changed.forEach(zone => {
                    if (zoneList[zone.zone_id]) {
                        zoneList[zone.zone_id].outputs = zone.outputs || [];
                        zoneList[zone.zone_id].state = zone.state || "unknown";
                        
                        // If this is our selected zone, update output info
                        if (zone.zone_id === selectedZone) {
                            updateSelectedZoneOutput();
                            
                            // Update current volume if available
                            if (selectedOutput && selectedOutput.volume) {
                                currentVolume = selectedOutput.volume.value;
                                console.log("Current volume updated:", currentVolume);
                            }
                        }
                    }
                });
            }
        });
    },
    
    core_unpaired: function(core) {
        console.log("Core unpaired");
        roonCore = null;
        transport = null;
        zoneList = {};
        selectedOutput = null;
    }
});

// Helper function to update the selected output based on selected zone
function updateSelectedZoneOutput() {
    if (!selectedZone || !zoneList[selectedZone]) {
        selectedOutput = null;
        return;
    }
    
    const outputs = zoneList[selectedZone].outputs;
    if (outputs && outputs.length > 0) {
        // Find the first output that has volume control
        selectedOutput = outputs.find(o => o.volume) || outputs[0];
        console.log("Selected output:", selectedOutput.output_id);
        
        // Update current volume
        if (selectedOutput.volume) {
            // Store the current volume from the Roon system
            currentVolume = selectedOutput.volume.value;
            console.log("Current volume:", currentVolume);
            
            // If the initialVolumeSet flag is not set, set initial volume
            if (!initialVolumeSet && transport) {
                const initialVolume = 5; // The initial volume level you want
                console.log(`Setting initial volume to ${initialVolume}`);
                transport.change_volume(selectedOutput.output_id, "absolute", initialVolume, function(error) {
                    if (error) {
                        console.log("Error setting initial volume:", error);
                    } else {
                        console.log("Initial volume set successfully");
                        initialVolumeSet = true;
                    }
                });
            }
        }
    } else {
        selectedOutput = null;
    }
}

// Set up status
let svc_status = new RoonApiStatus(roon);

// Create web server
const app = express();
const PORT = 3000; // Using port 3000 with port forwarding

app.use(bodyParser.urlencoded({ extended: true }));

// Home page
app.get('/', (req, res) => {
    const zoneOptions = Object.entries(zoneList).map(([id, info]) => {
        return `<option value="${id}" ${id === selectedZone ? 'selected' : ''}>${info.display_name}</option>`;
    }).join('');
    
    // Check if selectedZone exists in zoneList before trying to access its properties
    const selectedZoneName = (selectedZone && zoneList[selectedZone]) ? 
                             zoneList[selectedZone].display_name : 
                             'None';
                             
    const currentVolumeDisplay = (selectedOutput && selectedOutput.volume) ?
                                selectedOutput.volume.value :
                                'N/A';
    
    // Format battery information for display
    const batteryDisplay = deviceBatteryInfo.level !== null 
        ? `${deviceBatteryInfo.level}%` 
        : 'Unknown';
    
    const batteryLastUpdated = deviceBatteryInfo.lastUpdated 
        ? `Last updated: ${deviceBatteryInfo.lastUpdated.toLocaleTimeString()}` 
        : '';
    
    // Create a battery icon based on level
    let batteryIcon = '';
    let batteryColor = '';
    
    if (deviceBatteryInfo.level !== null) {
        if (deviceBatteryInfo.level >= 75) {
            batteryIcon = '🔋'; // Full battery
            batteryColor = 'color: green;';
        } else if (deviceBatteryInfo.level >= 40) {
            batteryIcon = '🔋'; // Medium battery
            batteryColor = 'color: orange;';
        } else {
            batteryIcon = '🪫'; // Low battery
            batteryColor = 'color: red;';
        }
    }
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Roon Volume Control</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
                select, button, input { padding: 8px; margin: 10px 0; }
                .status { margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 5px; }
                .controls { margin-top: 20px; }
                .battery-info { 
                    display: flex; 
                    align-items: center; 
                    ${batteryColor} 
                    font-weight: ${deviceBatteryInfo.level < 20 ? 'bold' : 'normal'};
                }
                .battery-icon { font-size: 1.5em; margin-right: 10px; }
                .battery-text { font-size: 1.1em; }
                .battery-updated { font-size: 0.8em; color: #666; margin-left: 10px; }
                .nav-links { margin-top: 20px; display: flex; gap: 20px; }
                .nav-links a { text-decoration: none; color: #0066cc; }
                h2 { border-bottom: 1px solid #ddd; padding-bottom: 5px; }
            </style>
        </head>
        <body>
            <h1>Roon Bluetooth Volume Control</h1>
            
            <form action="/set-zone" method="post">
                <label for="zone">Select Zone:</label>
                <select id="zone" name="zone">
                    <option value="">-- Select Zone --</option>
                    ${zoneOptions}
                </select>
                <button type="submit">Save</button>
            </form>
            
            <div class="status">
                <h2>Status</h2>
                <p>Selected Zone: ${selectedZoneName}</p>
                <p>Current Volume: ${currentVolumeDisplay}</p>
                <p>Device: VOL20 (${bluetoothConfig.macAddress || 'xx:xx:xx:xx:xx:xx'})</p>
                
                <div class="battery-info">
                    <span class="battery-icon">${batteryIcon}</span>
                    <span class="battery-text">Battery: ${batteryDisplay}</span>
                    <span class="battery-updated">${batteryLastUpdated}</span>
                </div>
            </div>
            
            <div class="nav-links">
                <a href="/refresh-battery">Refresh Battery</a>
                <a href="/restart-bluetooth">Restart Bluetooth Monitor</a>
                <a href="/homebridge-config">Homebridge Config</a>
                <a href="/update-homebridge" class="button">Force Update Homebridge</a>
            </div>
            
            <div class="controls">
                <h2>Controls</h2>
                <p>• Turn knob clockwise: Volume Up</p>
                <p>• Turn knob counter-clockwise: Volume Down</p>
                <p>• Press knob: Play/Pause</p>
            </div>
        </body>
        </html>
    `;
    
    res.send(html);
});

// Add a route to manually refresh battery information
app.get('/refresh-battery', async (req, res) => {
    await getDeviceBatteryInfo();
    res.redirect('/');
});

app.get('/update-homebridge', async (req, res) => {
    const batteryLevel = deviceBatteryInfo.level;
    console.log(`Manually triggering Homebridge update with battery level: ${batteryLevel}%`);
    
    if (batteryLevel !== null) {
        const success = await reportBatteryToHomebridgeWithConfig(batteryLevel);
        res.send(`
            <html><body>
                <h2>${success ? 'Success!' : 'Failed'}</h2>
                <p>${success ? `Battery level ${batteryLevel}% sent to Homebridge` : 'Failed to update Homebridge'}</p>
                <p><a href="/">Back to home</a></p>
            </body></html>
        `);
    } else {
        res.send(`
            <html><body>
                <h2>No battery level available</h2>
                <p>Please check the battery connection.</p>
                <p><a href="/">Back to home</a></p>
            </body></html>
        `);
    }
});

// Set zone
app.post('/set-zone', (req, res) => {
    const zoneId = req.body.zone;
    
    if (zoneId && zoneList[zoneId]) {
        selectedZone = zoneId;
        updateSelectedZoneOutput();
        
        const zoneName = zoneList[zoneId].display_name;
        svc_status.set_status(`Controlling zone: ${zoneName}`, false);
        console.log(`Selected zone: ${zoneName} (${zoneId})`);
        
        // Save the configuration
        saveConfig();
    } else {
        selectedZone = null;
        selectedOutput = null;
        svc_status.set_status("No zone selected", false);
        
        // Save the configuration (clearing the selection)
        saveConfig();
    }
    
    res.redirect('/');
});

// Webhook configuration page
app.get('/webhook', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Webhook Configuration</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                input, button { padding: 8px; margin: 10px 0; }
                .form { margin-top: 20px; }
                .back { margin-top: 20px; }
                .note { margin-top: 20px; color: #666; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <h1>Webhook Configuration</h1>
            
            <div class="form">
                <form action="/save-webhook" method="post">
                    <label for="url">Webhook URL:</label><br>
                    <input type="text" id="url" name="url" value="${webhookUrl || ''}" style="width: 100%; max-width: 500px;"><br>
                    <button type="submit">Save</button>
                </form>
            </div>
            
            <div class="note">
                <p>This webhook will be triggered when the play/pause button is pressed.</p>
                <p>For Homebridge webhook plugin, use a URL like: http://homebridge-ip:webhook-port/endpoint</p>
            </div>
            
            <div class="back">
                <a href="/">Back to main page</a>
            </div>
        </body>
        </html>
    `;
    
    res.send(html);
});

// Save webhook configuration
app.post('/save-webhook', (req, res) => {
    const url = req.body.url;
    
    if (url) {
        webhookUrl = url;
        saveWebhookConfig();
        console.log("Webhook URL saved:", webhookUrl);
    } else {
        webhookUrl = null;
        saveWebhookConfig();
        console.log("Webhook configuration cleared");
    }
    
    res.redirect('/webhook');
});

// Homebridge configuration page
app.get('/homebridge-config', (req, res) => {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Homebridge Configuration</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
                input, button, select { padding: 8px; margin: 10px 0; }
                label { display: block; margin-top: 15px; font-weight: bold; }
                .form { margin-top: 20px; }
                .back { margin-top: 20px; }
                .note { margin-top: 20px; color: #666; font-size: 0.9em; }
                .current { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                .checkbox-container { display: flex; align-items: center; }
                .checkbox-container input { margin-right: 10px; }
            </style>
        </head>
        <body>
            <h1>Homebridge Configuration</h1>
            
            <div class="current">
                <h2>Current Configuration</h2>
                <p><strong>Enabled:</strong> ${homebridgeConfig.enabled ? 'Yes' : 'No'}</p>
                <p><strong>Device Name:</strong> ${homebridgeConfig.deviceName}</p>
                <p><strong>Homebridge URL:</strong> ${homebridgeConfig.url}</p>
                <p><strong>Accessory ID:</strong> ${homebridgeConfig.accessoryId}</p>
                <p><strong>Battery Level:</strong> ${deviceBatteryInfo.level !== null ? deviceBatteryInfo.level + '%' : 'Unknown'}</p>
            </div>
            
            <div class="form">
                <form action="/save-homebridge-config" method="post">
                    <div class="checkbox-container">
                        <input type="checkbox" id="enabled" name="enabled" ${homebridgeConfig.enabled ? 'checked' : ''}>
                        <label for="enabled">Enable Homebridge Integration</label>
                    </div>
                    
                    <label for="deviceName">Device Name (for identification):</label>
                    <input type="text" id="deviceName" name="deviceName" value="${homebridgeConfig.deviceName}">
                    
                    <label for="url">Homebridge/HOOBS Server URL:</label>
                    <input type="text" id="url" name="url" value="${homebridgeConfig.url}" style="width: 100%; max-width: 500px;" 
                           placeholder="http://hoobs-ip-address:51828">
                    
                    <label for="accessoryId">Accessory ID:</label>
                    <input type="text" id="accessoryId" name="accessoryId" value="${homebridgeConfig.accessoryId}"
                           placeholder="vol20_kitchen_battery">
                    
                    <div style="margin-top: 20px;">
                        <button type="submit">Save Configuration</button>
                        <button type="button" onclick="window.location.href='/test-homebridge'">Test Connection</button>
                    </div>
                </form>
            </div>
            
            <div class="note">
                <p>For multiple VOL20 devices, use a unique Device Name and Accessory ID for each one.</p>
                <p>This integration requires the HTTP Webhooks plugin in Homebridge/HOOBS.</p>
                <p>Example setup in HOOBS:</p>
                <pre>
{
  "platform": "HttpWebHooks",
  "webhook_port": 51828,
  "sensors": [
    {
      "id": "vol20_dining_battery",
      "name": "VOL20 Dining Battery",
      "type": "battery"
    },
    {
      "id": "vol20_kitchen_battery",
      "name": "VOL20 Kitchen Battery", 
      "type": "battery"
    }
  ]
}
                </pre>
            </div>
            
            <div class="back">
                <a href="/">Back to main page</a>
            </div>
        </body>
        </html>
    `;
    
    res.send(html);
});

// Save Homebridge configuration
app.post('/save-homebridge-config', (req, res) => {
    homebridgeConfig.enabled = req.body.enabled === 'on';
    homebridgeConfig.deviceName = req.body.deviceName || `VOL20-${Math.floor(Math.random()*1000)}`;
    homebridgeConfig.url = req.body.url || 'http://localhost:51828';
    homebridgeConfig.accessoryId = req.body.accessoryId || 'vol20_battery';
    
    saveHomebridgeConfig();
    console.log("Homebridge configuration saved:", homebridgeConfig);
    
    res.redirect('/homebridge-config');
});

// Test Homebridge connection
app.get('/test-homebridge', async (req, res) => {
    if (!homebridgeConfig.enabled) {
        res.send(`
            <html><body>
                <h2>Homebridge integration is disabled</h2>
                <p>Please enable it first in the configuration.</p>
                <p><a href="/homebridge-config">Back to configuration</a></p>
            </body></html>
        `);
        return;
    }
    
    let success = false;
    let message = '';
    
    try {
        // Get current battery level
        const batteryLevel = deviceBatteryInfo.level !== null ? deviceBatteryInfo.level : 50;
        
        // Update the function to use configured values
        const reportResult = await reportBatteryToHomebridgeWithConfig(batteryLevel);
        
        if (reportResult) {
            success = true;
            message = `Successfully reported battery level ${batteryLevel}% to Homebridge`;
        } else {
            message = 'Failed to report to Homebridge. Check your configuration and Homebridge logs.';
        }
    } catch (err) {
        message = `Error: ${err.message}`;
    }
    
    const html = `
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; text-align: center; }
                .result { padding: 20px; margin: 20px 0; border-radius: 5px; }
                .success { background-color: #dff0d8; color: #3c763d; }
                .error { background-color: #f2dede; color: #a94442; }
            </style>
        </head>
        <body>
            <h1>Homebridge Connection Test</h1>
            
            <div class="result ${success ? 'success' : 'error'}">
                <h2>${success ? 'Success!' : 'Error'}</h2>
                <p>${message}</p>
            </div>
            
            <p><a href="/homebridge-config">Back to configuration</a></p>
        </body>
        </html>
    `;
    
    res.send(html);
});


// Function to control volume
function volumeUp() {
    if (!transport || !selectedOutput) {
        console.log("Transport or output not available");
        return;
    }
    
    console.log("VOLUME UP");
    // Change the step value from 1 to 0.5 to create smaller steps
    transport.change_volume(selectedOutput.output_id, "relative_step", 0.5, function(error) {
        if (error) {
            console.log("Error increasing volume:", error);
        } else {
            console.log("Volume increased");
        }
    });
}

function volumeDown() {
    if (!transport || !selectedOutput) {
        console.log("Transport or output not available");
        return;
    }
    
    console.log("VOLUME DOWN");
    // Change the step value from -1 to -0.5 to create smaller steps
    transport.change_volume(selectedOutput.output_id, "relative_step", -0.5, function(error) {
        if (error) {
            console.log("Error decreasing volume:", error);
        } else {
            console.log("Volume decreased");
        }
    });
}

function playPause() {
    if (!transport || !selectedZone) {
        console.log("Transport or zone not available");
        return;
    }
    
    console.log("PLAY/PAUSE");
    
    // Get the current state to know whether we're about to play or pause
    let currentState = "unknown";
    if (selectedZone && zoneList[selectedZone]) {
        currentState = zoneList[selectedZone].state;
    }
    
    transport.control(selectedZone, "playpause", function(error) {
        if (error) {
            console.log("Error toggling play/pause:", error);
        } else {
            console.log("Play/pause toggled");
            
            // Trigger appropriate webhook based on the previous state
            // If it was playing, we're now pausing, and vice versa
            const action = currentState === "playing" ? "pause" : "play";
            triggerWebhook(action);
        }
    });
}

async function reportBatteryToHomebridgeWithConfig(batteryLevel) {
    if (!homebridgeConfig.enabled) {
        console.log('Homebridge integration is disabled');
        return false;
    }
    
    if (batteryLevel === null || batteryLevel === undefined) {
        console.log('No battery level to report to Homebridge');
        return false;
    }
    
    try {
        const homebridgeUrl = homebridgeConfig.url;
        const accessoryId = homebridgeConfig.accessoryId;
        
        console.log(`Reporting battery level ${batteryLevel}% for ${homebridgeConfig.deviceName} to Homebridge at ${homebridgeUrl}`);
        
        // Make HTTP request to Homebridge with device name included in query
		const url = `${homebridgeUrl}/sensors?accessoryId=${accessoryId}&type=humidity&value=${batteryLevel}`;
		console.log(`Sending request to: ${url}`);  
		console.log(`Battery level type: ${typeof batteryLevel}, value: ${batteryLevel}`);      

        const response = await new Promise((resolve, reject) => {
            // Parse the URL to determine if we need http or https
            const isHttps = homebridgeUrl.startsWith('https');
            const httpModule = isHttps ? https : http;
            
            httpModule.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log(`Full Homebridge response: ${res.statusCode} ${data}`);
        			resolve({ statusCode: res.statusCode, data });
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
        
        console.log(`Homebridge response: ${response.statusCode} ${response.data}`);
        return response.statusCode === 200;
    } catch (err) {
        console.error('Error reporting battery to Homebridge:', err);
        return false;
    }
}

// Function to get battery information
async function getDeviceBatteryInfo() {
    const macAddress = bluetoothConfig.macAddress || 'XX:XX:XX:XX:XX:XX';
    
    try {
        console.log(`Checking battery for device ${macAddress}...`);
        
        // Use bluetoothctl info to get device information including battery
        const output = await new Promise((resolve, reject) => {
            exec(`bluetoothctl info ${macAddress}`, (err, stdout) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stdout);
                }
            });
        });
        
        // Log the complete output for debugging
        console.log('Bluetoothctl info output:');
        console.log(output);
        
        // Pattern for format: "Battery Percentage: 0x54 (84)"
        const batteryHexPattern = /Battery\s+Percentage:\s*(?:0x[0-9A-F]+)?\s*\((\d+)\)/i;
        const batteryHexMatch = output.match(batteryHexPattern);
        
        if (batteryHexMatch && batteryHexMatch[1]) {
            const batteryLevel = parseInt(batteryHexMatch[1], 10);
            console.log(`Found battery level in parentheses: ${batteryLevel}%`);
            
            deviceBatteryInfo = {
                level: batteryLevel,
                lastUpdated: new Date()
            };
            
            // Add a slight delay before reporting to ensure everything is ready
    		setTimeout(async () => {
        		await reportBatteryToHomebridgeWithConfig(batteryLevel);
    		}, 1000);
    
            return batteryLevel;
        }
        
        // Fallback: try to find just a hexadecimal value if parentheses format isn't found
        const hexPattern = /Battery\s+Percentage:\s*0x([0-9A-F]+)/i;
        const hexMatch = output.match(hexPattern);
        
        if (hexMatch && hexMatch[1]) {
            // Convert hex to decimal
            const batteryLevel = parseInt(hexMatch[1], 16);
            console.log(`Found battery level from hex: ${batteryLevel}%`);
            
            deviceBatteryInfo = {
                level: batteryLevel,
                lastUpdated: new Date()
            };
            
            await reportBatteryToHomebridge(batteryLevel);
            
            return batteryLevel;
        }
        
        console.log('Battery information not available or could not be parsed');
        return null;
    } catch (err) {
        console.error('Error getting battery information:', err);
        return null;
    }
}

// Function to report battery level to Homebridge
async function reportBatteryToHomebridge(batteryLevel) {
    if (batteryLevel === null || batteryLevel === undefined) {
        console.log('No battery level to report to Homebridge');
        return;
    }
    
    try {
        // Homebridge HTTP webhook URL
        const homebridgeUrl = 'http://localhost:51828';
        const accessoryId = 'vol20_battery';
        
        console.log(`Reporting battery level ${batteryLevel}% to Homebridge`);
        
        // Make HTTP request to Homebridge
        const url = `${homebridgeUrl}/sensors/humidity?accessoryId=${accessoryId}&value=${batteryLevel}`;
        
        const response = await new Promise((resolve, reject) => {
            http.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({ statusCode: res.statusCode, data });
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
        
        console.log(`Homebridge response: ${response.statusCode} ${response.data}`);
        return true;
    } catch (err) {
        console.error('Error reporting battery to Homebridge:', err);
        return false;
    }
}

// Function to ensure VOL20 is connected
async function ensureVOL20Connected() {
    const macAddress = bluetoothConfig.macAddress || 'F0:19:88:40:85:22'; // Use saved MAC or fallback
    
    console.log(`Checking connection to VOL20 (${macAddress})...`);
    
    try {
        // Check if device is connected
        const output = await new Promise((resolve, reject) => {
            exec(`bluetoothctl info ${macAddress} | grep "Connected: yes"`, (err, stdout) => {
                if (err && err.code !== 1) {
                    reject(err);
                } else {
                    resolve(stdout);
                }
            });
        });
        
        if (output && output.includes("Connected: yes")) {
            console.log("VOL20 is already connected");
            return true;
        }
        
        // Try to connect
        console.log("VOL20 is not connected, attempting to connect...");
        const connectOutput = await new Promise((resolve, reject) => {
            exec(`bluetoothctl connect ${macAddress}`, (err, stdout) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stdout);
                }
            });
        });
        
        if (connectOutput.includes("Connection successful")) {
            console.log("Successfully connected to VOL20");
            
            // Save the MAC address in configuration
            if (bluetoothConfig.macAddress !== macAddress) {
                bluetoothConfig.macAddress = macAddress;
                saveConfig();
            }
            
            return true;
        } else {
            console.log("Failed to connect to VOL20");
            return false;
        }
    } catch (err) {
        console.error("Error connecting to VOL20:", err);
        return false;
    }
}

// Start monitoring Bluetooth device
async function startBluetoothMonitoring() {
    console.log("Starting Bluetooth monitoring...");
    
    try {
        // Check if evtest is installed
        const evtestInstalled = await checkEvtestInstalled();
        if (!evtestInstalled) {
            console.error("evtest is not installed and could not be installed automatically");
            setTimeout(startBluetoothMonitoring, 30000); // Try again in 30 seconds
            return;
        }
        
        // Find the VOL20 device
        const devicePath = await findVOL20Device();
        console.log(`Using device: ${devicePath}`);
        
        // Check if the device exists
        if (!fs.existsSync(devicePath)) {
            console.error(`Device path ${devicePath} does not exist`);
            setTimeout(startBluetoothMonitoring, 10000);
            return;
        }
        
        // Run with sudo to ensure permissions
        const process = spawn('sudo', ['evtest', devicePath], {
            // Ensure the process stays attached to the parent
            detached: false,
            // Pipe the process's stdout to this process
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        // Add error handling for process startup
        process.on('error', (error) => {
            console.error("Error starting evtest:", error);
            setTimeout(() => {
                console.log("Attempting to restart Bluetooth monitoring...");
                startBluetoothMonitoring();
            }, 10000); // Wait 10 seconds before retrying
        });
        
        process.stdout.on('data', (data) => {
            const output = data.toString();
            
            // Watch for key down events only
            if (output.includes('KEY_VOLUMEUP') && output.includes('value 1')) {
                volumeUp();
            }
            
            if (output.includes('KEY_VOLUMEDOWN') && output.includes('value 1')) {
                volumeDown();
            }
            
            if (output.includes('KEY_PLAYPAUSE') && output.includes('value 1')) {
                playPause();
            }
        });
        
        // Log stderr output for debugging
        process.stderr.on('data', (data) => {
            console.error(`evtest stderr: ${data}`);
        });
        
        process.on('close', (code) => {
            console.log(`evtest process ended with code ${code}, restarting...`);
            
            // Delay the restart to avoid rapid cycling
            setTimeout(() => {
                startBluetoothMonitoring();
            }, 5000);
        });
    } catch (err) {
        console.error("Exception in startBluetoothMonitoring:", err);
        
        // Try again after a delay
        setTimeout(() => {
            startBluetoothMonitoring();
        }, 10000);
    }
}

// Function to ensure VOL20 is connected
async function ensureVOL20Connected() {
    const macAddress = bluetoothConfig.macAddress || 'XX:X:XX:XX:XX:XX'; // Use saved MAC or fallback
    
    console.log(`Checking connection to VOL20 (${macAddress})...`);
    
    try {
        // Check if device is connected
        const output = await new Promise((resolve, reject) => {
            exec(`bluetoothctl info ${macAddress} | grep "Connected: yes"`, (err, stdout) => {
                if (err && err.code !== 1) {
                    reject(err);
                } else {
                    resolve(stdout);
                }
            });
        });
        
        if (output && output.includes("Connected: yes")) {
            console.log("VOL20 is already connected");
            return true;
        }
        
        // Try to connect
        console.log("VOL20 is not connected, attempting to connect...");
        const connectOutput = await new Promise((resolve, reject) => {
            exec(`bluetoothctl connect ${macAddress}`, (err, stdout) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stdout);
                }
            });
        });
        
        if (connectOutput.includes("Connection successful")) {
            console.log("Successfully connected to VOL20");
            
            // Save the MAC address in configuration
            if (bluetoothConfig.macAddress !== macAddress) {
                bluetoothConfig.macAddress = macAddress;
                saveConfig();
            }
            
            return true;
        } else {
            console.log("Failed to connect to VOL20");
            return false;
        }
    } catch (err) {
        console.error("Error connecting to VOL20:", err);
        return false;
    }
}

// Set up periodic reconnection check
setInterval(async () => {
    const connected = await ensureVOL20Connected();
    if (connected) {
        console.log("VOL20 connection verified");
    } else {
        console.log("VOL20 connection check failed, will retry later");
    }
}, 60000); // Check every minute

// Initialise the app
async function initApp() {
    // Load configurations
    loadConfig();
    loadWebhookConfig();
    loadHomebridgeConfig();
    
    // Get initial battery information
    await getDeviceBatteryInfo();
    
    // Initialize Roon
    roon.init_services({
        required_services: [RoonApiTransport],
        provided_services: [svc_status]
    });
    
    // Start the monitoring
    startBluetoothMonitoring();
    
    // Start Roon discovery
    roon.start_discovery();
}

// Set up periodic battery check
setInterval(async () => {
    await getDeviceBatteryInfo();
}, 5 * 60 * 1000); // Check every 5 minutes

// Load saved configuration
loadConfig();

// Load webhook configuration
loadWebhookConfig();

// Start the app
app.listen(PORT, () => {
    console.log(`Web interface running at http://localhost:${PORT}`);
    initApp();
});

// Start Roon discovery
roon.start_discovery();

// Start Bluetooth monitoring
startBluetoothMonitoring();

console.log("Roon Bluetooth Volume Control started!");
