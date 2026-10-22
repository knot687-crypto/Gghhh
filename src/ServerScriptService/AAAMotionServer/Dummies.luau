--[[
	Sparring partners spawned at Generated/Layout.dummies:
	  Training Dummy   takes hits (flinches, launches, knockdowns)
	  Guard Dummy      holds its guard: shows block sparks, parries every third hit, and breaks
	                   under a charged heavy
	  Rival            AI swordsman: closes distance, chains combos, charges heavies, blocks
	NPC attacks use the same clips, hit geometry and resolve() path as players.
]]

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local ClipLibrary = require(AAAMotion.Animation.ClipLibrary)
local HitQuery = require(AAAMotion.Combat.HitQuery)
local Config = require(AAAMotion.Config)
local Net = require(AAAMotion.Net)
local Util = require(AAAMotion.Util)
local Layout = require(AAAMotion.Generated.Layout)
local Tuning = require(AAAMotion.Generated.Tuning)

local CombatServer = require(script.Parent.CombatServer)

local ATTACKS = Tuning.ATTACKS

local Dummies = {}

local KINDS = {
	{ label = "Training Dummy", kind = "training", tint = { Color3.fromRGB(199, 154, 102), Color3.fromRGB(180, 138, 90), Color3.fromRGB(169, 129, 84) } },
	{ label = "Guard Dummy", kind = "guard", tint = { Color3.fromRGB(150, 160, 178), Color3.fromRGB(70, 90, 120), Color3.fromRGB(46, 52, 66) } },
	{ label = "Rival", kind = "rival", tint = { Color3.fromRGB(197, 140, 102), Color3.fromRGB(74, 20, 24), Color3.fromRGB(28, 28, 32) } },
}

local rng = Random.new()

local function label(model: Model, text: string)
	local head = model:FindFirstChild("Head")
	if not head then
		return
	end
	local bb = Instance.new("BillboardGui")
	bb.Name = "AAALabel"
	bb.Size = UDim2.fromOffset(200, 28)
	bb.StudsOffset = Vector3.new(0, 2.6, 0)
	bb.AlwaysOnTop = false
	bb.MaxDistance = 90
	local t = Instance.new("TextLabel")
	t.BackgroundTransparency = 1
	t.Size = UDim2.fromScale(1, 1)
	t.Font = Enum.Font.GothamBold
	t.TextSize = 16
	t.TextColor3 = Color3.new(1, 1, 1)
	t.TextStrokeTransparency = 0.5
	t.Text = text
	t.Parent = bb
	bb.Parent = head
end

local function build(kind, position: Vector3, yaw: number): Model?
	local desc = Instance.new("HumanoidDescription")
	desc.HeadColor = kind.tint[1]
	desc.TorsoColor = kind.tint[2]
	desc.LeftArmColor = kind.tint[2]
	desc.RightArmColor = kind.tint[2]
	desc.LeftLegColor = kind.tint[3]
	desc.RightLegColor = kind.tint[3]
	local ok, model = pcall(function()
		return Players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
	end)
	if not ok or not model then
		warn("[AAAMotion] could not create dummy:", model)
		return nil
	end
	model.Name = kind.label
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("LuaSourceContainer") then
			d:Destroy()
		end
	end
	local hum = model:FindFirstChildOfClass("Humanoid") :: Humanoid
	hum.MaxHealth = 300
	hum.Health = 300
	hum.HealthDisplayType = Enum.HumanoidHealthDisplayType.AlwaysOn
	hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
	hum.UseJumpPower = true
	hum.JumpPower = Tuning.MOVE.jumpVelocity
	model:SetAttribute("AAA_Armed", kind.kind == "guard" or kind.kind == "rival")
	model:SetAttribute("AAA_Crouch", false)
	model:SetAttribute("AAA_Blocking", false)
	model:SetAttribute("AAA_Kind", kind.kind)
	local root = model:FindFirstChild("HumanoidRootPart") :: BasePart
	local height = hum.HipHeight + root.Size.Y / 2
	model:PivotTo(CFrame.new(position + Vector3.new(0, height, 0)) * CFrame.Angles(0, math.rad(yaw), 0))
	label(model, kind.label)
	model.Parent = workspace
	root:SetNetworkOwner(nil)
	CollectionService:AddTag(model, Config.CharacterTag)
	return model
end

-- ------------------------------------------------------------------ NPC attacks
local attackSeq = 0

local function playFor(npc: Model, clip: string, opts)
	Net.broadcast(nil, "Play", npc, clip, opts or {})
end

local function targets(except: Model): { HitQuery.Candidate }
	local out = {}
	for _, m in ipairs(CollectionService:GetTagged(Config.CharacterTag)) do
		if m ~= except and m:IsA("Model") then
			local root = m:FindFirstChild("HumanoidRootPart") :: BasePart?
			local hum = m:FindFirstChildOfClass("Humanoid")
			if root and hum and hum.Health > 0 and Players:GetPlayerFromCharacter(m) then
				table.insert(out, { model = m, root = root })
			end
		end
	end
	return out
end

-- Runs one attack for an NPC and returns the time until its combo window opens.
local function npcAttack(npc: Model, name: string): number
	local def = ATTACKS[name]
	local clip = ClipLibrary.get(def.clip)
	local root = npc:FindFirstChild("HumanoidRootPart") :: BasePart
	if not clip or not root then
		return 0.5
	end
	attackSeq += 1
	local s = CombatServer.state(npc)
	local atk = { name = name, id = -attackSeq, start = os.clock(), hits = {} }
	s.attack = atk
	local look = Util.flat(root.CFrame.LookVector)
	local frame = CFrame.new(root.Position) * CFrame.Angles(0, Util.yawOf(look), 0)
	playFor(npc, def.clip, { fadeIn = 0.05 })
	for _, m in ipairs(clip.markers) do
		if m.name == "HitStart" then
			task.delay(m.t, function()
				if s.attack ~= atk then
					return
				end
				local swing = HitQuery.swingAt(clip, m.t)
				for _, h in ipairs(HitQuery.swingHits(frame, def, swing, m.t, targets(npc))) do
					task.delay(math.max(0, h.t - m.t), function()
						if s.attack == atk and not (atk.hits[h.model] and atk.hits[h.model][m.finisher == true]) then
							atk.hits[h.model] = atk.hits[h.model] or {}
							atk.hits[h.model][m.finisher == true] = true
							CombatServer.resolve(npc, h.model, { attack = name, finisher = m.finisher == true, point = h.point, id = atk.id })
						end
					end)
				end
			end)
		elseif m.name == "HeavyImpact" then
			task.delay(m.t, function()
				if s.attack ~= atk then
					return
				end
				local center = root.Position + frame.LookVector * 4.5 - Vector3.new(0, 2.8, 0)
				for _, h in ipairs(HitQuery.radialHits(center, def.radius or 9, targets(npc))) do
					CombatServer.resolve(npc, h.model, { attack = name, finisher = true, id = atk.id })
				end
			end)
		end
	end
	task.delay(clip.length, function()
		if s.attack == atk then
			s.attack = nil
		end
	end)
	local window = clip.length
	for _, m in ipairs(clip.markers) do
		if m.name == "ComboWindow" then
			window = m.t
		end
	end
	return window
end

local function face(npc: Model, pos: Vector3)
	local root = npc:FindFirstChild("HumanoidRootPart") :: BasePart
	local flat = Util.flat(pos - root.Position)
	if flat.Magnitude > 0.1 then
		root.CFrame = CFrame.lookAt(root.Position, root.Position + flat.Unit)
	end
end

local function nearest(npc: Model, range: number): (Model?, number)
	local root = npc:FindFirstChild("HumanoidRootPart") :: BasePart
	local best, bestD = nil, range
	for _, c in ipairs(targets(npc)) do
		local d = (c.root.Position - root.Position).Magnitude
		if d < bestD then
			best, bestD = c.model, d
		end
	end
	return best, bestD
end

-- ------------------------------------------------------------------ brains
local function rivalBrain(npc: Model)
	local hum = npc:FindFirstChildOfClass("Humanoid") :: Humanoid
	local root = npc:FindFirstChild("HumanoidRootPart") :: BasePart
	local home = root.Position
	local s = CombatServer.state(npc)
	while npc.Parent and hum.Health > 0 do
		local target, dist = nearest(npc, 45)
		local now = os.clock()
		if not target then
			hum:MoveTo(home)
			task.wait(0.4)
		elseif now < s.stunUntil then
			task.wait(0.1)
		else
			local troot = target:FindFirstChild("HumanoidRootPart") :: BasePart
			local ts = CombatServer.state(target)
			local threatened = ts.attack ~= nil and now - ts.attack.start < 0.3 and dist < 11
			if threatened and rng:NextNumber() < 0.4 then
				face(npc, troot.Position)
				CombatServer.setBlocking(npc, true)
				task.wait(0.55 + rng:NextNumber() * 0.4)
				CombatServer.setBlocking(npc, false)
				task.wait(0.1)
			elseif dist > 7 then
				hum.WalkSpeed = if dist > 18 then Tuning.MOVE.sprintSpeed else Tuning.MOVE.walkSpeed
				hum:MoveTo(troot.Position - Util.unitOr(Util.flat(troot.Position - root.Position), Vector3.zAxis) * 5)
				task.wait(0.15)
			else
				hum:MoveTo(root.Position)
				face(npc, troot.Position)
				npc:SetAttribute("AAA_Armed", true)
				local roll = rng:NextNumber()
				if roll < 0.2 then
					playFor(npc, "HeavyCharge", { fadeIn = 0.12 })
					task.wait(0.7)
					if os.clock() < s.stunUntil or hum.Health <= 0 then
						continue
					end
					face(npc, troot.Position)
					task.wait(npcAttack(npc, "Heavy") + 0.5)
				else
					local chain = { "Light1", "Light2", "Light3", "Light4" }
					local n = if roll < 0.55 then 2 elseif roll < 0.85 then 3 else 4
					for i = 1, n do
						if os.clock() < s.stunUntil or hum.Health <= 0 or not npc.Parent then
							break
						end
						face(npc, troot.Position)
						local wait = npcAttack(npc, chain[i])
						task.wait(wait + 0.04)
					end
					task.wait(0.6 + rng:NextNumber() * 0.6)
				end
			end
		end
	end
end

local function guardBrain(npc: Model)
	local hum = npc:FindFirstChildOfClass("Humanoid") :: Humanoid
	CombatServer.setBlocking(npc, true)
	local s = CombatServer.state(npc)
	local blocked = 0
	while npc.Parent and hum.Health > 0 do
		local target = nearest(npc, 14)
		if target then
			local troot = target:FindFirstChild("HumanoidRootPart") :: BasePart
			face(npc, troot.Position)
			local ts = CombatServer.state(target)
			-- Every third swing is parried: re-raise the guard just as it lands.
			if ts.attack and ts.attack ~= s.lastSeen then
				s.lastSeen = ts.attack
				blocked += 1
				if blocked % 3 == 0 then
					CombatServer.setBlocking(npc, false)
					CombatServer.setBlocking(npc, true)
				end
			end
		end
		if not s.blocking and os.clock() > s.stunUntil then
			CombatServer.setBlocking(npc, true)
		end
		task.wait(0.05)
	end
end

local function regen(npc: Model)
	local hum = npc:FindFirstChildOfClass("Humanoid") :: Humanoid
	local last = hum.Health
	local quiet = 0
	while npc.Parent and hum.Health > 0 do
		task.wait(0.5)
		if hum.Health < last then
			quiet = 0
		else
			quiet += 0.5
		end
		if quiet >= 3 then
			hum.Health = math.min(hum.MaxHealth, hum.Health + hum.MaxHealth * 0.1)
		end
		last = hum.Health
	end
end

local function spawnLoop(kind, spec)
	local pos = Util.v3(spec.position)
	while true do
		local npc = build(kind, pos, spec.yaw or 0)
		if not npc then
			return
		end
		task.spawn(regen, npc)
		if kind.kind == "rival" then
			task.spawn(rivalBrain, npc)
		elseif kind.kind == "guard" then
			task.spawn(guardBrain, npc)
		end
		local hum = npc:FindFirstChildOfClass("Humanoid") :: Humanoid
		hum.Died:Wait()
		task.wait(3)
		npc:Destroy()
		if not Config.Combat.respawnDummies then
			return
		end
	end
end

function Dummies.start()
	for i, spec in ipairs(Layout.dummies) do
		local kind = KINDS[((i - 1) % #KINDS) + 1]
		task.spawn(spawnLoop, kind, spec)
	end
end

return Dummies
