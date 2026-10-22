// Demo course layout shared by the preview renderer and the generated Roblox DemoArena script.
// Units are studs; boxes are { name, center: [x, y, z], size: [x, y, z], material }.
export const LAYOUT = {
  floor: { size: [520, 1, 520], top: 0 },
  boxes: [
    // Vault rail: low obstacle the movement controller vaults over.
    { name: 'VaultRail', center: [36, 1.35, -40], size: [14, 2.7, 1.6], material: 'stone' },
    // Mantle block: tall ledge the controller climbs.
    { name: 'MantleBlock', center: [-36, 3.25, -46], size: [14, 6.5, 10], material: 'stone' },
    // Wall-run wall: long wall parallel to Z.
    { name: 'WallRunWall', center: [80, 9, -70], size: [2, 18, 90], material: 'stone' },
    // Drop tower for the high-fall roll / heavy landing.
    { name: 'DropTower', center: [-70, 8, 10], size: [10, 16, 10], material: 'stone' },
  ],
  dummies: [
    { name: 'Dummy1', position: [0, 0, -96], yaw: 180 },
    { name: 'Dummy2', position: [-9, 0, -104], yaw: 160 },
    { name: 'Dummy3', position: [9, 0, -104], yaw: 200 },
  ],
  spawn: { position: [0, 0, 0], yaw: 0 },
};
