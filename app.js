// Fix for 'global is not defined' error
const global = typeof window !== 'undefined' ? window : this;

// Update global constants function
function updateGlobalConstants(name, value) {
    try {
        global[name] = value;
        return true;
    } catch (err) {
        console.error(`Error updating global constant ${name}:`, err);
        return false;
    }
}

// Fix for the save-device-config route handler
app.post('/save-device-config', (req, res) => {
    try {
        const deviceName = req.body.deviceName || DEFAULT_DEVICE_NAME;
        const macAddress = req.body.macAddress || DEFAULT_DEVICE_MAC_ADDRESS;
        const startupVolume = parseInt(req.body.startupVolume) || DEFAULT_STARTUP_VOLUME;
        const extensionName = req.body.extensionName || DEFAULT_EXTENSION_NAME;
        const defaultZone = req.body.defaultZone || DEFAULT_ZONE_NAME;
        
        // Update the configuration
        bluetoothConfig.deviceName = deviceName;
        bluetoothConfig.macAddress = macAddress;
        bluetoothConfig.startupVolume = startupVolume;
        
        // Update global constants using the safer function
        updateGlobalConstants('DEFAULT_EXTENSION_NAME', extensionName);
        updateGlobalConstants('DEFAULT_ZONE_NAME', defaultZone);
        
        // Save the extension config to a new file
        try {
            const extensionConfig = {
                extensionName: extensionName,
                defaultZone: defaultZone,
                lastUpdated: new Date().toISOString()
            };
            
            fs.writeFileSync(path.join(__dirname, 'extension-config.json'), JSON.stringify(extensionConfig, null, 2));
            console.log("Extension configuration saved");
        } catch (err) {
            console.error("Error saving extension configuration:", err);
            // Continue despite the error
        }
        
        // Update Homebridge accessory ID and device name based on the default zone
        try {
            updateHomebridgeAccessoryId(defaultZone);
        } catch (err) {
            console.error("Error updating Homebridge accessory ID:", err);
            // Continue despite the error
        }
        
        // Update Roon extension name
        try {
            if (roon) {
                roon.update_settings({
                    display_name: getExtensionDisplayName()
                });
            }
        } catch (err) {
            console.error("Error updating Roon extension name:", err);
            // Continue despite the error
        }
        
        // Save the configuration
        try {
            saveConfig();
        } catch (err) {
            console.error("Error saving config:", err);
            // Continue despite the error
        }
        
        res.redirect('/device-config');
    } catch (err) {
        console.error("Error in save-device-config handler:", err);
        res.status(500).send(`
            <html><body>
                <h2>An error occurred</h2>
                <p>Error details: ${err.message}</p>
                <p><a href="/device-config">Back to device configuration</a></p>
            </body></html>
        `);
    }
});

// Fix for the set-zone route handler
app.post('/set-zone', (req, res) => {
    try {
        const zoneId = req.body.zone;
        
        if (zoneId && zoneList[zoneId]) {
            selectedZone = zoneId;
            updateSelectedZoneOutput();
            
            const zoneName = zoneList[zoneId].display_name;
            
            try {
                svc_status.set_status(`Controlling zone: ${zoneName}`, false);
            } catch (err) {
                console.error("Error updating status:", err);
            }
            
            console.log(`Selected zone: ${zoneName} (${zoneId})`);
            
            // Update the accessory ID based on the selected zone
            try {
                updateHomebridgeAccessoryId(zoneName);
            } catch (err) {
                console.error("Error updating Homebridge accessory ID:", err);
            }
            
            // Update Roon extension name
            try {
                if (roon) {
                    roon.update_settings({
                        display_name: getExtensionDisplayName()
                    });
                }
            } catch (err) {
                console.error("Error updating Roon extension name:", err);
            }
            
            // Save the configuration
            try {
                saveConfig();
            } catch (err) {
                console.error("Error saving config:", err);
            }
        } else {
            selectedZone = null;
            selectedOutput = null;
            
            try {
                svc_status.set_status("No zone selected", false);
            } catch (err) {
                console.error("Error updating status:", err);
            }
            
            // Save the configuration (clearing the selection)
            try {
                saveConfig();
            } catch (err) {
                console.error("Error saving config:", err);
            }
        }
        
        res.redirect('/');
    } catch (err) {
        console.error("Error in set-zone handler:", err);
        res.status(500).send(`
            <html><body>
                <h2>An error occurred</h2>
                <p>Error details: ${err.message}</p>
                <p><a href="/">Back to home</a></p>
            </body></html>
        `);
    }
});

// Fix for the save-homebridge-config route handler
app.post('/save-homebridge-config', (req, res) => {
    try {
        homebridgeConfig.enabled = req.body.enabled === 'on';
        homebridgeConfig.deviceName = req.body.deviceName || `${DEFAULT_DEVICE_NAME}-${Math.floor(Math.random()*1000)}`;
        homebridgeConfig.url = req.body.url || 'http://localhost:51828';
        homebridgeConfig.accessoryId = req.body.accessoryId || 'vol20_battery';
        
        try {
            saveHomebridgeConfig();
        } catch (err) {
            console.error("Error saving Homebridge config:", err);
        }
        
        console.log("Homebridge configuration saved:", homebridgeConfig);
        
        res.redirect('/homebridge-config');
    } catch (err) {
        console.error("Error in save-homebridge-config handler:", err);
        res.status(500).send(`
            <html><body>
                <h2>An error occurred</h2>
                <p>Error details: ${err.message}</p>
                <p><a href="/homebridge-config">Back to Homebridge configuration</a></p>
            </body></html>
        `);
    }
});

// Fix for the save-webhook route handler
app.post('/save-webhook', (req, res) => {
    try {
        const url = req.body.url;
        
        if (url) {
            webhookUrl = url;
            try {
                saveWebhookConfig();
            } catch (err) {
                console.error("Error saving webhook config:", err);
            }
            console.log("Webhook URL saved:", webhookUrl);
        } else {
            webhookUrl = null;
            try {
                saveWebhookConfig();
            } catch (err) {
                console.error("Error saving webhook config:", err);
            }
            console.log("Webhook configuration cleared");
        }
        
        res.redirect('/webhook');
    } catch (err) {
        console.error("Error in save-webhook handler:", err);
        res.status(500).send(`
            <html><body>
                <h2>An error occurred</h2>
                <p>Error details: ${err.message}</p>
                <p><a href="/webhook">Back to webhook configuration</a></p>
            </body></html>
        `);
    }
});

// Improved error handling for saveConfig
function saveConfig() {
    const config = {
        selectedZone: selectedZone,
        bluetoothConfig: bluetoothConfig, // Save Bluetooth config as well
        lastUpdated: new Date().toISOString()
    };
    
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log("Configuration saved");
        return true;
    } catch (err) {
        console.error("Error saving configuration:", err);
        return false;
    }
}

// Helper function to check if roon is initialized
function isRoonInitialized() {
    return roon !== null && typeof roon.update_settings === 'function';
}

// Safe version of updateHomebridgeAccessoryId
function updateHomebridgeAccessoryId(zoneName) {
    if (!zoneName) return false;
    
    try {
        // Create a safe accessory ID from the zone name
        const safeZoneName = zoneName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const newAccessoryId = `${DEFAULT_ACCESSORY_ID_PREFIX}${safeZoneName}_battery`;
        
        // Update device name too
        const newDeviceName = `${DEFAULT_DEVICE_NAME}-${zoneName.replace(/\s+/g, '')}`;
        
        // Only update if it's different
        if (homebridgeConfig.accessoryId !== newAccessoryId || homebridgeConfig.deviceName !== newDeviceName) {
            console.log(`Updating Homebridge config for zone ${zoneName}`);
            console.log(`Accessory ID: ${homebridgeConfig.accessoryId} -> ${newAccessoryId}`);
            console.log(`Device Name: ${homebridgeConfig.deviceName} -> ${newDeviceName}`);
            
            homebridgeConfig.accessoryId = newAccessoryId;
            homebridgeConfig.deviceName = newDeviceName;
            
            // Save the updated configuration
            saveHomebridgeConfig();
            return true;
        }
        
        return false;
    } catch (err) {
        console.error(`Error updating Homebridge accessory ID for zone ${zoneName}:`, err);
        return false;
    }
}

// Safe version of getExtensionDisplayName
function getExtensionDisplayName() {
    try {
        // If a zone is selected and exists in the zone list, use it in the display name
        if (selectedZone && zoneList[selectedZone]) {
            return `${DEFAULT_EXTENSION_NAME} - ${zoneList[selectedZone].display_name}`;
        }
        // Otherwise, if a default zone name is provided, use that
        else if (DEFAULT_ZONE_NAME) {
            return `${DEFAULT_EXTENSION_NAME} - ${DEFAULT_ZONE_NAME}`;
        }
        // Fallback to just the extension name
        return DEFAULT_EXTENSION_NAME;
    } catch (err) {
        console.error("Error getting extension display name:", err);
        return DEFAULT_EXTENSION_NAME || "Bluetooth Volume Control";
    }
}
