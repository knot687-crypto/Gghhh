--[[
	Server authority for combat and action replication.

	Clients play their own actions instantly and report them; the server
	  * relays animation plays to everyone else (rate limited, sanitised),
	  * owns the replicated flags (AAA_Armed / AAA_Crouch / AAA_Blocking),
	  * validates hit claims against its own positions and the attack's timing and reach,
	  * resolves block / parry / guard break, applies damage and knockback,
	  * broadcasts the verdict so every client plays the same reaction.
	NPC attacks run through the same resolve() path.
]]

local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local ClipLibrary = require(AAAMotion.Animation.ClipLibrary)
local Config = require(AAAMotion.Config)
local Net = require(AAAMotion.Net)
local Util = require(AAAMotion.Util)
local Tuning = require(AAAMotion.Generated.Tuning)

local ATTACKS = Tuning.ATTACKS
local DEFENSE = Tuning.DEFENSE

local CombatServer = {}

type State = {
	blocking: boolean,
	blockStart: number,
	guard: number,
	lastGuardHit: number,
	stunUntil: number,
	attack: any,
	plays: { number },
}

local states: { [Model]: State } = {}

local function state(model: Model): State
	local s = states[model]
	if not s then
		s = {
			blocking = false,
			blockStart = 0,
			guard = DEFENSE.guardMax,
			lastGuardHit = 0,
			stunUntil = 0,
			attack = nil,
			plays = {},
		}
		states[model] = s
	end
	return s
end
CombatServer.state = state

local function rootOf(model: Instance?): BasePart?
	if not model or not model:IsA("Model") then
		return nil
	end
	return model:FindFirstChild("HumanoidRootPart") :: BasePart?
end

local function alive(model: Model): boolean
	local h = model:FindFirstChildOfClass("Humanoid")
	return h ~= nil and h.Health > 0 and rootOf(model) ~= nil
end

function CombatServer.setBlocking(model: Model, on: boolean)
	local s = state(model)
	if on and not s.blocking then
		s.blockStart = os.clock()
	end
	s.blocking = on
	model:SetAttribute("AAA_Blocking", on)
end

-- ------------------------------------------------------------------ resolution
--[[
	Applies one hit from attacker to victim.
	opts: { attack = name, finisher = bool, point = Vector3?, id = number?, radial = bool? }
	Returns the result string.
]]
function CombatServer.resolve(attacker: Model, victim: Model, opts): string?
	local aroot, vroot = rootOf(attacker), rootOf(victim)
	if not aroot or not vroot or not alive(victim) then
		return nil
	end
	local def = ATTACKS[opts.attack]
	if not def then
		return nil
	end
	local finisher = opts.finisher == true
	if finisher and def.finisher then
		def = Util.merge(def, def.finisher)
	end
	local now = os.clock()
	local vs = state(victim)
	local dir = Util.unitOr(Util.flat(vroot.Position - aroot.Position), aroot.CFrame.LookVector)
	local facing = (-dir):Dot(vroot.CFrame.LookVector)
	local point = opts.point or (vroot.Position + Vector3.new(0, 0.5, 0))
	local result
	local damage = def.damage or 0
	local knock, launch = Vector3.zero, 0

	if vs.blocking and facing > 0.2 and not def.guardBreak then
		local latency = 0.1
		if now - vs.blockStart <= DEFENSE.parryWindow + latency then
			result = "parried"
			damage = 0
			CombatServer.setBlocking(victim, false)
			local as = state(attacker)
			as.stunUntil = now + DEFENSE.parryStun
			as.attack = nil
		else
			vs.guard -= DEFENSE.guardDamage
			vs.lastGuardHit = now
			if vs.guard <= 0 then
				result = "guardbreak"
				vs.guard = DEFENSE.guardMax
				CombatServer.setBlocking(victim, false)
				vs.stunUntil = now + 1.0
				damage *= 0.5
			else
				result = "blocked"
				damage *= DEFENSE.blockDamageScale
				knock = dir * DEFENSE.blockPush
			end
		end
	elseif vs.blocking and def.guardBreak then
		result = "guardbreak"
		CombatServer.setBlocking(victim, false)
		vs.stunUntil = now + 1.0
		damage *= 0.6
	else
		result = "hit"
		if def.knockback or finisher then
			knock = dir * (def.knockback or 30)
			launch = def.launch or 20
		elseif def.launch then
			knock = dir * (def.push or 4)
			launch = def.launch
		else
			knock = dir * (def.push or 6)
		end
		vs.stunUntil = now + (def.stun or 0.4)
		-- A hit interrupts the victim's own attack and guard.
		vs.attack = nil
		if vs.blocking then
			CombatServer.setBlocking(victim, false)
		end
	end

	local hum = victim:FindFirstChildOfClass("Humanoid")
	if hum and damage > 0 then
		hum:TakeDamage(damage)
	end

	-- Knockback: players simulate their own character, so their client applies it.
	local vplayer = Players:GetPlayerFromCharacter(victim)
	if launch > 0 then
		if vplayer then
			Net.sendTo(vplayer, "Knock", knock, launch)
		else
			vroot.AssemblyLinearVelocity = knock + Vector3.new(0, launch, 0)
		end
	elseif not vplayer and knock.Magnitude > 0 then
		vroot.AssemblyLinearVelocity += knock
	end

	Net.broadcast(nil, "Hit", {
		attacker = attacker,
		victim = victim,
		attack = opts.attack,
		finisher = finisher,
		result = result,
		point = point,
		dir = dir,
		id = opts.id,
		launch = launch > 0,
		stun = def.stun,
		shake = def.shake,
		push = if launch > 0 then 0 else knock.Magnitude,
	})
	return result
end

-- ------------------------------------------------------------------ player messages
local function sanitizeOpts(o)
	local out = {}
	if type(o) ~= "table" then
		return out
	end
	if type(o.fadeIn) == "number" then
		out.fadeIn = math.clamp(o.fadeIn, 0, 1)
	end
	if type(o.speed) == "number" then
		out.speed = math.clamp(o.speed, 0.1, 3)
	end
	if type(o.hold) == "boolean" then
		out.hold = o.hold
	end
	if typeof(o.dir) == "Vector3" and o.dir.Magnitude < 2 then
		out.dir = o.dir
	end
	return out
end

local function rateOk(s: State): boolean
	local now = os.clock()
	local keep = {}
	for _, t in ipairs(s.plays) do
		if now - t < 1 then
			table.insert(keep, t)
		end
	end
	s.plays = keep
	if #keep >= 24 then
		return false
	end
	table.insert(keep, now)
	return true
end

local function reachOf(def): number
	local box = def.hitbox
	if not box then
		return (def.radius or 9) + 2
	end
	local o, z = box.offset, box.size
	return Vector3.new(math.abs(o[1]) + z[1] / 2, math.abs(o[2]) + z[2] / 2, math.abs(o[3]) + z[3] / 2).Magnitude
end

local function onClaim(player: Player, char: Model, s: State, name, finisher, victims, id, center)
	local atk = s.attack
	if type(name) ~= "string" or type(victims) ~= "table" or not atk or atk.name ~= name or atk.id ~= id then
		return
	end
	local def = ATTACKS[name]
	local clip = def and ClipLibrary.get(def.clip)
	if not clip then
		return
	end
	local elapsed = os.clock() - atk.start
	if elapsed > clip.length + 0.75 then
		return
	end
	local aroot = rootOf(char)
	if not aroot then
		return
	end
	local radial = typeof(center) == "Vector3"
	if radial and (center - aroot.Position).Magnitude > 10 then
		return
	end
	local reach = reachOf(def) + 10 -- latency forgiveness
	local count = 0
	for _, v in ipairs(victims) do
		count += 1
		if count > 8 then
			break
		end
		if typeof(v) == "Instance" and v:IsA("Model") and v ~= char and CollectionService:HasTag(v, Config.CharacterTag) and alive(v) then
			local key = tostring(finisher == true)
			atk.hits[v] = atk.hits[v] or {}
			if not atk.hits[v][key] then
				local vroot = rootOf(v) :: BasePart
				local ok
				if radial then
					ok = Util.flat(vroot.Position - center).Magnitude <= (def.radius or 9) + 4
				else
					ok = (vroot.Position - aroot.Position).Magnitude <= reach
				end
				if ok then
					atk.hits[v][key] = true
					CombatServer.resolve(char, v, { attack = name, finisher = finisher == true, id = id, radial = radial })
				end
			end
		end
	end
end

function CombatServer.onMessage(player: Player, kind, ...)
	local char = player.Character
	if not char or not alive(char) or type(kind) ~= "string" then
		return
	end
	local s = state(char)
	local now = os.clock()
	if kind == "Play" then
		local name, opts = ...
		if type(name) == "string" and ClipLibrary.get(name) and not string.match(name, "^FP_") and rateOk(s) then
			Net.broadcast(player, "Play", char, name, sanitizeOpts(opts))
		end
	elseif kind == "Stop" then
		local fade = ...
		Net.broadcast(player, "Stop", char, if type(fade) == "number" then math.clamp(fade, 0, 1) else 0.15)
	elseif kind == "State" then
		local flags = ...
		if type(flags) ~= "table" then
			return
		end
		if type(flags.armed) == "boolean" then
			char:SetAttribute("AAA_Armed", flags.armed)
		end
		if type(flags.crouch) == "boolean" then
			char:SetAttribute("AAA_Crouch", flags.crouch)
		end
		if type(flags.blocking) == "boolean" then
			CombatServer.setBlocking(char, flags.blocking and now >= s.stunUntil)
		end
	elseif kind == "Attack" then
		local name, yaw, id = ...
		if type(name) ~= "string" or not ATTACKS[name] or now < s.stunUntil - 0.15 then
			return
		end
		s.attack = { name = name, id = id, start = now, yaw = tonumber(yaw) or 0, hits = {} }
		if s.blocking then
			CombatServer.setBlocking(char, false)
		end
		char:SetAttribute("AAA_Armed", true)
	elseif kind == "HitClaim" then
		onClaim(player, char, s, ...)
	end
end

-- Guard regeneration.
function CombatServer.step(dt: number)
	local now = os.clock()
	for model, s in pairs(states) do
		if not model.Parent then
			states[model] = nil
		elseif now - s.lastGuardHit > 1 and s.guard < DEFENSE.guardMax then
			s.guard = math.min(DEFENSE.guardMax, s.guard + DEFENSE.guardRegen * dt)
		end
	end
end

function CombatServer.start()
	Net.remote("C2S").OnServerEvent:Connect(CombatServer.onMessage)
	game:GetService("RunService").Heartbeat:Connect(CombatServer.step)
end

return CombatServer
