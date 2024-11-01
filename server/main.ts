import * as Cfx from '@nativewrappers/fivem/server';
import { CreateVehicle, GetPlayer, GetVehicle, OxPlayer, OxVehicle, SpawnVehicle } from '@overextended/ox_core/server';
import { addCommand, cache } from '@overextended/ox_lib/server';
import { Data } from '../@types/Data';
import * as config from '../config.json';
import * as db from './db';
import { getArea, hasItem, removeItem, sendNotification } from './utils';

const restrictedGroup: string = `group.${config.ace_group}`;
const pendingTransfers = new Map<number, { vehicleId: number; playerId: number }>();

async function listVehicles(source: number): Promise<Data[]> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return [];

  const vehicles: Data[] | undefined = await db.getOwnedVehicles(player.charId);
  if (vehicles.length > 0) {
    sendNotification(source, `^#5e81ac--------- ^#ffffffYour Vehicles ^#5e81ac---------`);
    sendNotification(source, vehicles.map(vehicle => `ID: ^#5e81ac${vehicle.id} ^#ffffff| Plate: ^#5e81ac${vehicle.plate} ^#ffffff| Model: ^#5e81ac${vehicle.model} ^#ffffff| Status: ^#5e81ac${vehicle.stored}^#ffffff --- `).join('\n'));
  } else {
    sendNotification(source, '^#d73232ERROR ^#ffffffYou do not own any vehicles.');
  }

  return vehicles;
}

async function parkVehicle(source: number): Promise<boolean | undefined> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  // @ts-ignore
  const ped: number = GetVehiclePedIsIn(GetPlayerPed(source), false);
  if (ped === 0) {
    sendNotification(source, '^#d73232You are not inside of a vehicle!');
    return false;
  }

  const vehicle: OxVehicle = GetVehicle(ped);
  if (!vehicle?.owner) {
    sendNotification(source, `^#d73232ERROR ^#ffffffYou are not the owner of this vehicle (^#5e81ac${vehicle.plate}^#ffffff).`);
    return false;
  }

  if (!hasItem(source, config.money_item, config.parking_cost)) {
    sendNotification(source, `^#d73232ERROR ^#ffffffYou need $${config.parking_cost} to park your vehicle.`);
    return false;
  }

  const success: boolean = await removeItem(source, config.money_item, config.parking_cost);
  if (!success) return false;

  const update = await db.setVehicleStatus(vehicle.id, 'stored');
  if (!update) return false;

  vehicle.setStored('stored', true);
  sendNotification(source, `^#5e81acYou paid ^#ffffff$${config.parking_cost} ^#5e81acto park your vehicle ^#ffffff${vehicle.model} ^#5e81acwith plate number ^#ffffff${vehicle.plate}`);
  return true;
}

async function getVehicle(source: number, args: { vehicleId: number }): Promise<boolean | undefined> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const vehicleId: number = args.vehicleId;
  const owner = await db.getVehicleOwner(vehicleId, player.charId);
  if (!owner) {
    sendNotification(source, `^#d73232You can not retrieve a vehicle you do not own!`);
    return false;
  }

  const status: 1 | undefined = await db.getVehicleStatus(vehicleId, 'stored');
  if (!status) {
    sendNotification(source, `^#d73232ERROR ^#ffffffVehicle with id ${vehicleId} is not stored, it is either outside or at the impound lot.`);
    return false;
  }

  if (!hasItem(source, config.money_item, config.retrieval_cost)) {
    sendNotification(source, `^#d73232ERROR ^#ffffffYou need $${config.impound_cost} to retrieve your vehicle.`);
    return false;
  }

  const success: boolean = await removeItem(source, config.money_item, config.retrieval_cost);
  if (!success) return false;

  const vehicle: OxVehicle = await SpawnVehicle(vehicleId, player.getCoords());
  if (!vehicle) {
    sendNotification(source, '^#d73232ERROR ^#ffffffFailed to spawn vehicle.');
    return false;
  }

  const update = await db.setVehicleStatus(vehicleId, 'outside');
  if (!update) return false;

  vehicle.setStored('outside', false);
  sendNotification(source, `^#5e81acYou paid ^#ffffff$${config.retrieval_cost} ^#5e81acto retrieve your vehicle`);
  return true;
}

async function returnVehicle(source: number, args: { vehicleId: number }): Promise<boolean | undefined> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const coords = player.getCoords();
  if (getArea({ x: coords[0], y: coords[1], z: coords[2] }, config.impound_location)) {
    const vehicleId: number = args.vehicleId;

    const owner = await db.getVehicleOwner(vehicleId, player.charId);
    if (!owner) {
      sendNotification(source, `^#d73232You can not restore a vehicle you do not own!`);
      return false;
    }

    const status: 1 | undefined = await db.getVehicleStatus(vehicleId, 'impound');
    if (!status) {
      sendNotification(source, `^#d73232ERROR ^#ffffffVehicle with id ${vehicleId} is not impounded.`);
      return false;
    }

    if (!hasItem(source, config.money_item, config.impound_cost)) {
      sendNotification(source, `^#d73232ERROR ^#ffffffYou need $${config.impound_cost} to restore this vehicle.`);
      return false;
    }

    const success: boolean = await removeItem(source, config.money_item, config.impound_cost);
    if (!success) return false;

    const update = await db.setVehicleStatus(vehicleId, 'stored');
    if (!update) return false;

    sendNotification(source, `^#5e81acYou paid ^#ffffff$${config.impound_cost} ^#5e81acto restore your vehicle`);
    return true;
  } else {
    sendNotification(source, '^#d73232You are not in the impound area!');
    return false;
  }
}

async function adminDeleteVehicle(source: number, args: { plate: string }): Promise<boolean | undefined> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const plate: string = args.plate;
  const result: 1 | undefined = await db.getVehiclePlate(plate);
  if (!result) {
    sendNotification(source, `^#d73232ERROR ^#ffffffVehicle with plate number ${plate} does not exist.`);
    return false;
  }

  const success = await db.deleteVehicle(plate);
  if (!success) return false;

  sendNotification(source, `^#5e81acSuccessfully deleted vehicle with plate number ^#ffffff${plate}`);
  return true;
}

async function adminSetVehicle(source: number, args: { model: string }): Promise<void> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const model: string = args.model;
  const data = { owner: player.charId, model: model };

  const vehicle: OxVehicle = await CreateVehicle(data, player.getCoords());
  if (!vehicle?.owner) return;

  vehicle.setStored('outside', false);
  sendNotification(source, `^#5e81acSuccessfully spawned vehicle ^#ffffff${model} ^#5e81acwith plate number ^#ffffff${vehicle.plate} ^#5e81acand set it as owned`);
}

async function adminGiveVehicle(source: number, args: { playerId: number; model: string }): Promise<void> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const playerId: number = args.playerId;
  const target: OxPlayer = GetPlayer(playerId);
  if (!target?.charId) {
    sendNotification(source, `^#d73232ERROR ^#ffffffNo player found with id ${playerId}.`);
    return;
  }

  const model: string = args.model;
  const data = { owner: target.charId, model: model };

  const vehicle: OxVehicle = await CreateVehicle(data, player.getCoords());
  if (!vehicle?.owner) return;

  vehicle.setStored('stored', true);
  sendNotification(source, `^#5e81acSuccessfully gave vehicle ^#ffffff${model} ^#5e81acto player with id ^#ffffff${playerId}`);
}

async function adminViewVehicles(source: number, args: { playerId: number }): Promise<void> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const playerId: number = args.playerId;
  const target: OxPlayer = GetPlayer(playerId);
  if (!target?.charId) {
    sendNotification(source, `^#d73232ERROR ^#ffffffNo player found with id ${playerId}.`);
    return;
  }

  const vehicles: Data[] = await db.getOwnedVehicles(target.charId);
  if (vehicles.length === 0) {
    sendNotification(source, `^#d73232ERROR ^#ffffffNo vehicles found for player with id ${playerId}.`);
    return;
  }

  sendNotification(source, `^#5e81ac--------- ^#ffffffPlayer (${playerId}) Owned Vehicles ^#5e81ac---------`);
  sendNotification(source, vehicles.map(vehicle => `ID: ^#5e81ac${vehicle.id} ^#ffffff| Plate: ^#5e81ac${vehicle.plate} ^#ffffff| Model: ^#5e81ac${vehicle.model} ^#ffffff| Status: ^#5e81ac${vehicle.stored}^#ffffff --- `).join('\n'));
}

async function requestTransfer(source: number, args: { vehicleId: number; playerId: number; confirm?: string }): Promise<boolean | undefined> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const vehicleId: number = args.vehicleId;
  const playerId: number = args.playerId;
  const confirm: string | undefined = args.confirm;

  if (confirm) {
    const pending = pendingTransfers.get(source);
    if (!pending) {
      sendNotification(source, `^#d73232You have no pending vehicle transfer to confirm!`);
      return false;
    }

    const target = GetPlayer(pending.playerId);
    if (target) {
      sendNotification(target.source, `^#5e81acYou have a vehicle transfer pending. Type /acceptvehicle to accept.`);
    }

    sendNotification(source, `^#5e81acTransfer request successfully sent.`);
    return false;
  }

  const target: OxPlayer = GetPlayer(playerId);
  if (!target?.charId) {
    sendNotification(source, `^#d73232ERROR ^#ffffffNo player found with id ${playerId}.`);
    return false;
  }

  const owner = await db.getVehicleOwner(vehicleId, player.charId);
  if (!owner) {
    sendNotification(source, `^#d73232ERROR ^#ffffffYou cannot transfer a vehicle you do not own!`);
    return false;
  }

  pendingTransfers.set(source, { vehicleId, playerId });
  sendNotification(source, `^#5e81acPlease confirm the transfer of vehicle with id ^#ffffff(${vehicleId}) ^#5e81acby typing the command again with "confirm"`);
  return false;
}

async function acceptTransfer(source: number): Promise<boolean | undefined> {
  const player: OxPlayer = GetPlayer(source);
  if (!player?.charId) return;

  const pending = Array.from(pendingTransfers.entries()).find(([_, { playerId }]) => playerId === player.charId);
  if (!pending) {
    sendNotification(source, `^#d73232ERROR ^#ffffffYou have no vehicle transfer pending.`);
    return false;
  }

  const { vehicleId } = pending[1];
  const success = await db.transferVehicle(vehicleId, player.charId);
  if (!success) {
    sendNotification(source, `^#d73232ERROR ^#ffffffFailed to accept vehicle transfer.`);
    return false;
  }

  const owner = GetPlayer(pending[0]);
  if (owner) {
    sendNotification(owner.source, `^#5e81acThe transfer of your vehicle to ^#ffffff${player.fullName} ^#5e81acwas successful.`);
  }

  sendNotification(source, `^#5e81acYou have successfully accepted the vehicle transfer.`);
  pendingTransfers.delete(pending[0]);
  return true;
}

addCommand(['list', 'vl'], listVehicles, {
  restricted: false,
});

addCommand(['park', 'vp'], parkVehicle, {
  restricted: false,
});

addCommand(['get', 'vg'], getVehicle, {
  params: [
    {
      name: 'vehicleId',
      paramType: 'number',
      optional: false,
    },
  ],
  restricted: false,
});

addCommand(['impound', 'rv'], returnVehicle, {
  params: [
    {
      name: 'vehicleId',
      paramType: 'number',
      optional: false,
    },
  ],
  restricted: false,
});

addCommand(['deletevehicle'], adminDeleteVehicle, {
  params: [
    {
      name: 'plate',
      paramType: 'string',
      optional: false,
    },
  ],
  restricted: restrictedGroup,
});

addCommand(['admincar'], adminSetVehicle, {
  params: [
    {
      name: 'model',
      paramType: 'string',
      optional: false,
    },
  ],
  restricted: restrictedGroup,
});

addCommand(['addvehicle'], adminGiveVehicle, {
  params: [
    {
      name: 'playerId',
      paramType: 'number',
      optional: false,
    },
    {
      name: 'model',
      paramType: 'string',
      optional: false,
    },
  ],
  restricted: restrictedGroup,
});

addCommand(['viewvehicles'], adminViewVehicles, {
  params: [
    {
      name: 'playerId',
      paramType: 'number',
      optional: false,
    },
  ],
  restricted: restrictedGroup,
});

addCommand(['transfervehicle'], requestTransfer, {
  params: [
    {
      name: 'vehicleId',
      paramType: 'number',
      optional: false,
    },
    {
      name: 'playerId',
      paramType: 'number',
      optional: false,
    },
    {
      name: 'confirm',
      paramType: 'string',
      optional: true,
    },
  ],
  restricted: false,
});

addCommand(['acceptvehicle'], acceptTransfer, {
  restricted: false,
});

on('onResourceStart', async (resourceName: string): Promise<void> => {
  if (resourceName !== 'fivem-parking') return;

  await Cfx.Delay(100);

  try {
    console.log(`\x1b[32m[${cache.resource}] Successfully started ${cache.resource}.\x1b[0m`);
    const vehicles: Data[] = await db.fetchVehiclesTable();
    if (vehicles.length > 0) {
      console.log(`\x1b[32m[${cache.resource}] Loaded ${vehicles.length} vehicles from the database.\x1b[0m`);
    } else {
      console.warn(`\x1b[33m[${cache.resource}] No vehicles found or ${vehicles} does not exist.\x1b[0m`);
    }
  } catch (error) {
    console.error(`\x1b[31m[${cache.resource}] Failed to start ${cache.resource}: ${error}\x1b[0m`);
  }
});
