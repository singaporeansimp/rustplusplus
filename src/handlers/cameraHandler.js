/*

    Copyright (C) 2022 Alexander Emanuelsson (alexemanuelol)

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

    https://github.com/alexemanuelol/rustplusplus

*/

const DiscordMessages = require('../discordTools/discordMessages.js');

const CAMERA_CYCLING_DWELL_TIME_MS = 5000;
const CAMERA_CYCLING_GAP_MS = 1000;
const CAMERA_DEDUP_COOLDOWN_MS = 5 * 60 * 1000; /* 5 minutes */

module.exports = {
    startCycling: function (rustplus, client) {
        if (rustplus.cameraCyclingActive) return;

        const instance = client.getInstance(rustplus.guildId);
        const server = instance.serverList[rustplus.serverId];
        if (!server || !server.cameras || Object.keys(server.cameras).length === 0) return;

        rustplus.cameraCyclingActive = true;
        rustplus.cameraCyclingIndex = 0;
        rustplus.cameraSeenPlayers = {};

        rustplus.log(client.intlGet(null, 'infoCap'), client.intlGet(null, 'cameraCyclingStarted'));
        module.exports.cycleStep(rustplus, client);
    },

    stopCycling: function (rustplus) {
        if (!rustplus.cameraCyclingActive) return;

        if (rustplus.cameraCyclingTaskId) {
            clearTimeout(rustplus.cameraCyclingTaskId);
            rustplus.cameraCyclingTaskId = null;
        }

        if (rustplus.cameraCurrentSubscription !== null) {
            rustplus.unsubscribeFromCameraAsync(5000).catch(() => { /* Ignore */ });
            rustplus.cameraCurrentSubscription = null;
        }

        rustplus.cameraCyclingActive = false;
        rustplus.cameraRayDataReceived = false;
    },

    cycleStep: async function (rustplus, client) {
        if (!rustplus.isOperational) {
            module.exports.stopCycling(rustplus);
            return;
        }

        const instance = client.getInstance(rustplus.guildId);
        const server = instance.serverList[rustplus.serverId];
        if (!server || !server.cameras || Object.keys(server.cameras).length === 0) {
            module.exports.stopCycling(rustplus);
            return;
        }

        /* Cameras can only be monitored when the Rust+ user is offline/dead */
        const player = rustplus.team ? rustplus.team.getPlayer(rustplus.playerId) : null;
        if (player && player.isAlive) {
            rustplus.cameraCyclingTaskId = setTimeout(
                module.exports.cycleStep, CAMERA_CYCLING_GAP_MS, rustplus, client);
            return;
        }

        const cameraKeys = Object.keys(server.cameras);
        if (rustplus.cameraCyclingIndex >= cameraKeys.length) {
            rustplus.cameraCyclingIndex = 0;
        }

        const identifier = cameraKeys[rustplus.cameraCyclingIndex];
        const camera = server.cameras[identifier];

        /* Prune expired dedup entries */
        const now = Date.now();
        for (const key of Object.keys(rustplus.cameraSeenPlayers)) {
            if (now - rustplus.cameraSeenPlayers[key] > CAMERA_DEDUP_COOLDOWN_MS) {
                delete rustplus.cameraSeenPlayers[key];
            }
        }

        /* Subscribe to the camera */
        const response = await rustplus.subscribeToCameraAsync(identifier, 10000);

        if (!response || response.error || !(await rustplus.isResponseValid(response))) {
            if (camera.reachable) {
                camera.reachable = false;
                client.setInstance(rustplus.guildId, instance);
                rustplus.log(client.intlGet(null, 'warningCap'),
                    client.intlGet(null, 'cameraUnreachable', { camera: identifier }));
            }

            rustplus.cameraCyclingIndex++;
            rustplus.cameraCyclingTaskId = setTimeout(
                module.exports.cycleStep, CAMERA_CYCLING_GAP_MS, rustplus, client);
            return;
        }

        camera.reachable = true;
        client.setInstance(rustplus.guildId, instance);

        rustplus.cameraCurrentSubscription = identifier;
        rustplus.cameraRayDataReceived = false;

        /* Wait for ray data with dwell timeout */
        await new Promise(resolve => setTimeout(resolve, CAMERA_CYCLING_DWELL_TIME_MS));

        /* Unsubscribe */
        await rustplus.unsubscribeFromCameraAsync(5000).catch(() => { /* Ignore */ });
        rustplus.cameraCurrentSubscription = null;

        /* Advance index and schedule next step */
        rustplus.cameraCyclingIndex++;
        rustplus.cameraCyclingTaskId = setTimeout(
            module.exports.cycleStep, CAMERA_CYCLING_GAP_MS, rustplus, client);
    },

    processCameraRays: async function (rustplus, client, message) {
        if (!message.broadcast || !message.broadcast.cameraRays) return;
        if (!message.broadcast.cameraRays.entities) return;

        const instance = client.getInstance(rustplus.guildId);
        const serverId = rustplus.serverId;
        const server = instance.serverList[serverId];
        if (!server || !server.cameras) return;

        const identifier = rustplus.cameraCurrentSubscription;
        if (!identifier || !server.cameras[identifier]) return;

        const camera = server.cameras[identifier];
        const now = Date.now();

        for (const entity of message.broadcast.cameraRays.entities) {
            if (entity.type !== 2) continue; /* Only Player entities */
            if (!entity.name) continue;

            const dedupKey = `${identifier}:${entity.name}`;
            const lastSeen = rustplus.cameraSeenPlayers[dedupKey];

            if (lastSeen && (now - lastSeen < CAMERA_DEDUP_COOLDOWN_MS)) {
                continue; /* Within cooldown, skip Discord notification */
            }

            rustplus.cameraSeenPlayers[dedupKey] = now;

            rustplus.log(client.intlGet(null, 'infoCap'),
                client.intlGet(null, 'cameraPlayerSightedLog', {
                    player: entity.name,
                    camera: camera.name
                }));

            await DiscordMessages.sendCameraPlayerSightingMessage(
                rustplus.guildId, serverId, identifier, camera.name, entity.name);
        }
    }
};
