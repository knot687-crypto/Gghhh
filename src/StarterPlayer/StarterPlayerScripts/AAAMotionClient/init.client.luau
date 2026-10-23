--[[
	AAA Motion client entry point.

	Frame order
		PreSimulation   LocalController (abilities, root motion)  ->  every CharacterDriver
		                (animation, Motor6D.Transform, cosmetic VFX)
		PostSimulation  every CharacterDriver: secondary motion (cloth) on the posed parts
		RenderStep      Viewmodel (Camera)  ->  CameraController (Camera + 1)  ->  HUD
]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local Effects = require(AAAMotion.VFX.Effects)
local CameraFX = require(AAAMotion.VFX.CameraFX)
local HitQuery = require(AAAMotion.Combat.HitQuery)
local Net = require(AAAMotion.Net)
local Util = require(AAAMotion.Util)
local Tuning = require(AAAMotion.Generated.Tuning)

local Drivers = require(script.Drivers)
local LocalController = require(script.LocalController)
local CameraController = require(script.CameraController)
local Viewmodel = require(script.Viewmodel)
local Input = require(script.Input)
local HUD = require(script.HUD)

local player = Players.LocalPlayer
local ATTACKS = Tuning.ATTACKS

local camera = CameraController.new()
local hud = HUD.new()
local controller = nil
local viewmodel = nil

-- ------------------------------------------------------------------ local character
local function onDriver(driver)
	if driver.model ~= player.Character then
		return
	end
	if controller then
		controller:destroy()
	end
	if viewmodel then
		viewmodel:destroy()
	end
	controller = LocalController.new(driver, camera)
	viewmodel = Viewmodel.new(driver)
	camera.viewmodel = viewmodel
	camera:setSubject(driver, controller)
end

Drivers.added:Connect(onDriver)
Drivers.start()
for _, d in pairs(Drivers.all()) do
	onDriver(d)
end

player.CharacterRemoving:Connect(function()
	if controller then
		controller:destroy()
		controller = nil
	end
end)

Input.bind(function(action, down)
	if action == "ToggleView" then
		if down then
			camera:toggleView()
		end
		return
	end
	if controller then
		controller:onAction(action, down)
	end
end)

-- ------------------------------------------------------------------ frame loop
RunService.PreSimulation:Connect(function(dt)
	local ts = CameraFX.timeScale()
	Effects.setTimeScale(ts)
	if controller and controller.root.Parent then
		controller:step(dt)
	end
	Drivers.update(dt, ts)
end)

RunService.PostSimulation:Connect(function(dt)
	Drivers.postUpdate(dt, CameraFX.timeScale())
end)

RunService:BindToRenderStep("AAAMotionViewmodel", Enum.RenderPriority.Camera.Value, function(dt)
	if viewmodel and controller and camera:isFirstPerson() then
		viewmodel:update(dt, CameraFX.timeScale(), controller)
	end
end)
camera:start()
RunService:BindToRenderStep("AAAMotionHUD", Enum.RenderPriority.Camera.Value + 2, function(dt)
	local intensity = 0
	if controller then
		local speed = Util.flat(controller.root.AssemblyLinearVelocity).Magnitude
		intensity = math.clamp((speed - 30) / 40, 0, 1)
		if controller.mode == "Dash" then
			intensity = 1
		end
	end
	hud:update(dt, intensity, camera:isFirstPerson())
end)

-- ------------------------------------------------------------------ server messages
local function attackDef(name: string?, finisher: boolean?)
	local def = name and ATTACKS[name] or {}
	if finisher and def.finisher then
		def = Util.merge(def, def.finisher)
	end
	return def
end

local function onHit(info)
	local attacker = Drivers.get(info.attacker)
	local victim = Drivers.get(info.victim)
	local me = player.Character
	local isAttacker = info.attacker ~= nil and info.attacker == me
	local isVictim = info.victim ~= nil and info.victim == me
	local predicted = isAttacker and controller ~= nil and controller:wasPredicted(info.victim, info.id)
	local def = attackDef(info.attack, info.finisher)
	local point = info.point or (victim and victim.root.Position) or Vector3.zero
	local dir = info.dir or Vector3.zAxis
	local r = info.result
	if r == "hit" then
		if not predicted then
			Effects.play(def.effect or "Hit", point, { slash = dir, normal = dir })
			if attacker then
				attacker.anim:hitStop(def.hitStop or 0.07, 0)
			end
			if victim then
				victim:flash(1)
				victim.anim:hitStop(def.hitStop or 0.07, 0.07)
				if not isVictim and info.launch then
					victim:launch()
				elseif not info.launch and attacker then
					victim:play(HitQuery.flinch(victim.root.CFrame, attacker.root.Position), { fadeIn = 0.02 })
				end
			end
			if isAttacker then
				CameraFX.shake(def.shake or "Light")
				if def.impactFrame then
					CameraFX.impactFrame(def.impactFrame)
				end
			end
		end
		if isVictim and controller then
			controller:onHitResult(info)
		end
	elseif r == "blocked" then
		Effects.play("Block", point, { normal = -dir })
		if attacker then
			attacker.anim:hitStop(0.06, 0)
		end
		if victim then
			victim.anim:hitStop(0.06, 0.04)
			if not isVictim then
				victim:play("BlockHit", { fadeIn = 0.02 })
			end
		end
		if isVictim and controller then
			controller:onHitResult(info)
		elseif isAttacker then
			CameraFX.shake("Light", 0.6)
		end
	elseif r == "parried" then
		Effects.play("Parry", point, { normal = -dir })
		if victim then
			victim.anim:hitStop(0.1, 0)
			if not isVictim then
				victim:play("Parry", { fadeIn = 0.02 })
			end
		end
		if attacker then
			attacker.anim:hitStop(0.1, 0.05)
			if not isAttacker then
				attacker:play("Parried", { fadeIn = 0.03 })
			end
		end
		if isVictim and controller then
			controller:onHitResult(info)
		elseif isAttacker and controller then
			controller:onParried()
		end
	elseif r == "guardbreak" then
		Effects.play("HitHeavy", point, { slash = dir })
		if victim then
			victim:flash(1)
			if not isVictim then
				victim:play("GuardBreak", { fadeIn = 0.03 })
			end
		end
		if isVictim and controller then
			controller:onHitResult(info)
		end
		if isAttacker then
			CameraFX.shake("Heavy", 0.8)
		end
	end
end

Net.remote("S2C").OnClientEvent:Connect(function(kind, a, b, c)
	if kind == "Play" then
		if a ~= player.Character then
			local d = Drivers.get(a)
			if d then
				local opts = if type(c) == "table" then c else {}
				d.dashDir = opts.dir
				d:play(b, opts)
			end
		end
	elseif kind == "Stop" then
		if a ~= player.Character then
			local d = Drivers.get(a)
			if d then
				d:stopAction(b)
			end
		end
	elseif kind == "Hit" then
		onHit(a)
	elseif kind == "Knock" then
		if controller then
			controller:knockback(a, b)
		end
	elseif kind == "Effect" then
		if a ~= player.Character then
			Effects.play(b, c.position, c)
		end
	end
end)
