--[[
	AAA Motion server entry point: remotes, collision groups, demo arena, player setup,
	combat authority and sparring dummies.
]]

local CollectionService = game:GetService("CollectionService")
local PhysicsService = game:GetService("PhysicsService")
local Players = game:GetService("Players")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local Config = require(AAAMotion.Config)
local Net = require(AAAMotion.Net)
local Tuning = require(AAAMotion.Generated.Tuning)

local Arena = require(script.Arena)
local CombatServer = require(script.CombatServer)
local Dummies = require(script.Dummies)

-- Set to false to use your own map (or add a Workspace.AAAArena model).
local BUILD_DEMO_ARENA = true
local SPAWN_DUMMIES = true

Net.remote("C2S")

-- Vault/mantle root motion passes over obstacle edges in this group.
pcall(function()
	if not PhysicsService:IsCollisionGroupRegistered("AAAGhost") then
		PhysicsService:RegisterCollisionGroup("AAAGhost")
	end
	PhysicsService:CollisionGroupSetCollidable("AAAGhost", "Default", false)
	PhysicsService:CollisionGroupSetCollidable("AAAGhost", "AAAGhost", false)
end)

if BUILD_DEMO_ARENA then
	Arena.build()
end

local function setupCharacter(char: Model)
	local hum = char:WaitForChild("Humanoid", 10) :: Humanoid?
	if not hum then
		return
	end
	char:SetAttribute("AAA_Armed", false)
	char:SetAttribute("AAA_Crouch", false)
	char:SetAttribute("AAA_Blocking", false)
	hum.MaxHealth = Config.Combat.maxHealth
	hum.Health = Config.Combat.maxHealth
	hum.UseJumpPower = true
	hum.JumpPower = Tuning.MOVE.jumpVelocity
	hum.WalkSpeed = Tuning.MOVE.walkSpeed
	CollectionService:AddTag(char, Config.CharacterTag)
end

local function onPlayer(player: Player)
	player.CharacterAdded:Connect(setupCharacter)
	if player.Character then
		task.spawn(setupCharacter, player.Character)
	end
end
Players.PlayerAdded:Connect(onPlayer)
for _, p in ipairs(Players:GetPlayers()) do
	onPlayer(p)
end

CombatServer.start()
if SPAWN_DUMMIES then
	Dummies.start()
end
