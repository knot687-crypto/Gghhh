--[[
	Katana + scabbard built from parts (no mesh uploads needed), matching the preview model.

	Weapon space: origin = grip centre, +Y toward the tip, cutting edge toward -Z (the same frame
	the clips' "Weapon" joint and baked swing paths use).

	Weapons are client-local cosmetics: every client builds one per animated character and moves
	it between the right hand and the hip as the animation's WeaponAttach markers say. Hit
	detection never touches these parts.
]]

local Generated = script.Parent.Parent.Generated
local WeaponData = require(Generated.Weapon)
local Rig = require(Generated.Rig)
local Util = require(script.Parent.Parent.Util)

local K = WeaponData.KATANA

local STEEL = Color3.fromRGB(214, 219, 228)
local EDGE = Color3.fromRGB(205, 238, 255)
local EDGE_HOT = Color3.fromRGB(127, 216, 255)
local GOLD = Color3.fromRGB(184, 145, 63)
local DARK = Color3.fromRGB(21, 21, 26)
local WRAP = Color3.fromRGB(22, 22, 26)
local SAME = Color3.fromRGB(232, 226, 210)
local LACQUER = Color3.fromRGB(16, 16, 20)

-- Cross-section of the blade at fraction s (0 = habaki, 1 = tip). Mirror of bladeFrame() in
-- tools/anim/weapon.mjs.
local function bladeFrame(s: number)
	local W = K.baseWidth + (K.tipWidth - K.baseWidth) * s
	local y = K.bladeStart + (K.bladeEnd - K.bladeStart) * s
	local c = K.sori * s * s
	local zE = -W * 0.55 + c
	local zB = W * 0.45 + c
	local k = 0.88
	if s > k then
		local u = (s - k) / (1 - k)
		zE = zE + (zB - zE) * u ^ 1.6
	end
	local tS = 0.034 - 0.012 * s
	if s > k then
		tS *= 1 - (s - k) / (1 - k) * 0.85
	end
	return { y = y, zE = zE, zB = zB, tS = tS, W = W }
end

local function newPart(class: string, name: string, size: Vector3, color: Color3, material: Enum.Material): any
	local p = Instance.new(class) :: any
	p.Name = name
	p.Size = size
	p.Color = color
	p.Material = material
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Massless = true
	p.Anchored = false
	p.CastShadow = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	return p
end

local function weld(root: BasePart, part: BasePart, offset: CFrame)
	local w = Instance.new("Weld")
	w.Part0 = root
	w.Part1 = part
	w.C0 = offset
	w.Parent = part
	part.CFrame = root.CFrame * offset
end

local Weapon = {}
Weapon.__index = Weapon
Weapon.bladeFrame = bladeFrame

--[[
	opts.scale      uniform scale (first-person viewmodels use Weapon.VM_SCALE)
	opts.scabbard   also build the saya (third person only)
	opts.parent     where the model lives (default: a local folder in workspace)
]]
function Weapon.new(opts)
	local o = opts or {}
	local s = o.scale or 1
	local self = setmetatable({}, Weapon)
	self.scale = s
	self.edges = {} :: { BasePart }
	self.glow = -1

	local model = Instance.new("Model")
	model.Name = o.name or "AAAKatana"
	self.model = model

	local handle = newPart("Part", "Handle", Vector3.new(0.2, 0.2, 0.2) * s, DARK, Enum.Material.SmoothPlastic)
	handle.Transparency = 1
	handle.CastShadow = false
	handle.Parent = model
	model.PrimaryPart = handle
	self.handle = handle

	-- Blade: curved segments following the sori, plus a glowing hamon strip along the edge.
	local N = 10
	for i = 0, N - 1 do
		local s0, s1 = i / N, (i + 1) / N
		local f0, f1 = bladeFrame(s0), bladeFrame(s1)
		local zc0, zc1 = (f0.zE + f0.zB) / 2, (f1.zE + f1.zB) / 2
		local dy, dz = f1.y - f0.y, zc1 - zc0
		local len = math.sqrt(dy * dy + dz * dz)
		local tilt = CFrame.Angles(math.atan2(dz, dy), 0, 0)
		local mid = Vector3.new(0, (f0.y + f1.y) / 2, (zc0 + zc1) / 2)
		local width = (f0.W + f1.W) / 2
		local thick = (f0.tS + f1.tS)
		if i < N - 1 then
			local seg = newPart("Part", "Blade", Vector3.new(thick, len + 0.015, width) * s, STEEL, Enum.Material.SmoothPlastic)
			seg.Reflectance = 0.32
			seg.Parent = model
			weld(handle, seg, CFrame.new(mid * s) * tilt)
			-- Slightly proud of both flats so the hamon band shows on each side.
			local edge = newPart("Part", "Edge", Vector3.new(thick + 0.008, len + 0.015, 0.05) * s, EDGE, Enum.Material.Neon)
			edge.CastShadow = false
			edge.Parent = model
			local ez = ((f0.zE + f1.zE) / 2 + 0.03)
			weld(handle, edge, CFrame.new(Vector3.new(0, mid.Y, ez) * s) * tilt)
			table.insert(self.edges, edge)
		else
			-- Kissaki: a wedge whose slope runs from the edge up to the spine at the point.
			local zE0, zB0 = f0.zE, f0.zB
			local tip = newPart("WedgePart", "Kissaki", Vector3.new(thick, dy, zB0 - zE0) * s, STEEL, Enum.Material.SmoothPlastic)
			tip.Reflectance = 0.32
			tip.Parent = model
			weld(handle, tip, CFrame.new(Vector3.new(0, (f0.y + f1.y) / 2, (zE0 + zB0) / 2) * s))
		end
	end

	-- Fittings.
	local habaki = newPart("Part", "Habaki", Vector3.new(0.075, 0.12, 0.22) * s, GOLD, Enum.Material.Metal)
	habaki.Parent = model
	weld(handle, habaki, CFrame.new(0, 0.53 * s, 0))

	local axisY = CFrame.Angles(0, 0, math.pi / 2) -- cylinder axis (X) -> weapon +Y
	local tsuba = newPart("Part", "Tsuba", Vector3.new(0.055, 0.46, 0.46) * s, DARK, Enum.Material.Metal)
	tsuba.Shape = Enum.PartType.Cylinder
	tsuba.Parent = model
	weld(handle, tsuba, CFrame.new(0, K.guardY * s, 0) * axisY)
	local rim = newPart("Part", "TsubaRim", Vector3.new(0.035, 0.49, 0.49) * s, GOLD, Enum.Material.Metal)
	rim.Shape = Enum.PartType.Cylinder
	rim.Parent = model
	weld(handle, rim, CFrame.new(0, K.guardY * s, 0) * axisY)

	local fuchi = newPart("Part", "Fuchi", Vector3.new(0.06, 0.2, 0.2) * s, GOLD, Enum.Material.Metal)
	fuchi.Shape = Enum.PartType.Cylinder
	fuchi.Parent = model
	weld(handle, fuchi, CFrame.new(0, 0.4 * s, 0) * axisY)

	local tsukaLen = 0.42 - K.handleStart
	local tsuka = newPart("Part", "Tsuka", Vector3.new(0.15, tsukaLen, 0.19) * s, WRAP, Enum.Material.Fabric)
	tsuka.Parent = model
	weld(handle, tsuka, CFrame.new(0, (0.42 + K.handleStart) / 2 * s, 0))
	-- Same (ray skin) diamonds showing through the wrap on both flats.
	local count = 6
	for i = 0, count - 1 do
		local y = K.handleStart + 0.13 + i * (tsukaLen - 0.26) / (count - 1)
		for _, side in ipairs({ 1, -1 }) do
			local d = newPart("Part", "Diamond", Vector3.new(0.012, 0.085, 0.085) * s, SAME, Enum.Material.SmoothPlastic)
			d.CastShadow = false
			d.Parent = model
			weld(handle, d, CFrame.new(side * 0.078 * s, y * s, 0) * CFrame.Angles(math.pi / 4, 0, 0))
		end
	end
	local kashira = newPart("Part", "Kashira", Vector3.new(0.08, 0.19, 0.19) * s, GOLD, Enum.Material.Metal)
	kashira.Shape = Enum.PartType.Cylinder
	kashira.Parent = model
	weld(handle, kashira, CFrame.new(0, (K.handleStart - 0.02) * s, 0) * axisY)

	-- Points the trails/ribbons and VFX use.
	self.attachments = {}
	for name, p in pairs(WeaponData.POINTS) do
		local a = Instance.new("Attachment")
		a.Name = "Trail" .. string.upper(string.sub(name, 1, 1)) .. string.sub(name, 2)
		a.Position = Util.v3(p) * s
		a.Parent = handle
		self.attachments[name] = a
	end
	local inner = Instance.new("Attachment")
	inner.Name = "TrailInner"
	inner.Position = Vector3.new(0, K.bladeStart + (K.trailTip - K.bladeStart) * 0.58, 0.02) * s
	inner.Parent = handle
	self.attachments.inner = inner

	local light = Instance.new("PointLight")
	light.Name = "EdgeLight"
	light.Color = EDGE_HOT
	light.Range = 8 * s
	light.Brightness = 0
	light.Shadows = false
	light.Enabled = false
	light.Parent = self.attachments.mid
	self.light = light

	-- Motor that carries the weapon: Part0 = RightHand (drawn) or LowerTorso (sheathed).
	local motor = Instance.new("Motor6D")
	motor.Name = "AAAWeapon"
	motor.Part1 = handle
	motor.Parent = handle
	self.motor = motor

	if o.scabbard then
		self:buildScabbard(s)
	end
	model.Parent = o.parent or Weapon.localFolder()
	self:setGlow(0.35)
	return self
end

function Weapon:buildScabbard(s: number)
	local root = newPart("Part", "SayaRoot", Vector3.new(0.2, 0.2, 0.2) * s, LACQUER, Enum.Material.SmoothPlastic)
	root.Transparency = 1
	root.CastShadow = false
	root.Parent = self.model
	local N = 8
	local y0 = K.guardY + 0.03
	for i = 0, N - 1 do
		local s0, s1 = i / N, (i + 1) / N
		local f0, f1 = bladeFrame(s0), bladeFrame(s1)
		local a = Vector3.new(0, if i == 0 then y0 else f0.y + 0.05, (f0.zE + f0.zB) / 2)
		local b = Vector3.new(0, f1.y + 0.05, (f1.zE + f1.zB) / 2)
		local d = b - a
		local seg = newPart(
			"Part",
			"Saya",
			Vector3.new(0.14, d.Magnitude + 0.02, (f0.W + f1.W) / 2 + 0.085) * s,
			LACQUER,
			Enum.Material.SmoothPlastic
		)
		seg.Reflectance = 0.12
		seg.Parent = self.model
		weld(root, seg, CFrame.new(((a + b) / 2) * s) * CFrame.Angles(math.atan2(d.Z, d.Y), 0, 0))
	end
	local endF = bladeFrame(1)
	local koiguchi = newPart("Part", "Koiguchi", Vector3.new(0.155, 0.08, K.baseWidth + 0.1) * s, GOLD, Enum.Material.Metal)
	koiguchi.Parent = self.model
	weld(root, koiguchi, CFrame.new(0, (y0 + 0.06) * s, 0))
	local kurikata = newPart("Part", "Kurikata", Vector3.new(0.16, 0.05, K.baseWidth + 0.095) * s, GOLD, Enum.Material.Metal)
	kurikata.Parent = self.model
	weld(root, kurikata, CFrame.new(0, (y0 + 0.75) * s, 0.01 * s))
	local kojiri = newPart(
		"Part",
		"Kojiri",
		Vector3.new(0.15, 0.1, endF.W + 0.09) * s,
		GOLD,
		Enum.Material.Metal
	)
	kojiri.Parent = self.model
	weld(root, kojiri, CFrame.new(0, (endF.y + 0.06) * s, ((endF.zE + endF.zB) / 2 + 0.02) * s))
	local w = Instance.new("Weld")
	w.Name = "AAASaya"
	w.Part1 = root
	w.Parent = root
	self.sayaRoot = root
	self.sayaWeld = w
end

local folder: Folder? = nil
function Weapon.localFolder(): Folder
	if folder and folder.Parent then
		return folder
	end
	local f = workspace:FindFirstChild("AAAMotionLocal")
	if not f then
		f = Instance.new("Folder")
		f.Name = "AAAMotionLocal"
		f.Parent = workspace
	end
	folder = f :: Folder
	return f :: Folder
end

local HAND_C0
for _, j in ipairs(Rig.R15.joints) do
	if j.name == "Weapon" then
		HAND_C0 = j
	end
end
local SHEATH = Rig.R15.sheath

-- Attach to a character: mode "hand" or "sheath". posScale scales the offsets for big/small rigs.
function Weapon:attach(character: Model, mode: string, posScale: number?)
	local ps = posScale or 1
	local hand = character:FindFirstChild("RightHand") :: BasePart?
	local torso = character:FindFirstChild("LowerTorso") :: BasePart?
	if self.sayaWeld and torso then
		self.sayaWeld.Part0 = torso
		self.sayaWeld.C0 = Util.cframe({ SHEATH.c0[1] * ps, SHEATH.c0[2] * ps, SHEATH.c0[3] * ps }, SHEATH.c0r)
	end
	self.mode = mode
	if mode == "hand" and hand then
		self.motor.Part0 = hand
		local c = HAND_C0.c0
		self.motor.C0 = Util.cframe({ c[1] * ps, c[2] * ps, c[3] * ps }, HAND_C0.c0r)
	elseif torso then
		self.motor.Part0 = torso
		self.motor.Transform = CFrame.identity
		self.motor.C0 = Util.cframe({ SHEATH.c0[1] * ps, SHEATH.c0[2] * ps, SHEATH.c0[3] * ps }, SHEATH.c0r)
	end
end

-- Attach to a viewmodel hand (first person).
function Weapon:attachToPart(part: BasePart, c0: CFrame)
	self.motor.Part0 = part
	self.motor.C0 = c0
	self.mode = "hand"
end

-- Writes the clip's Weapon joint (only meaningful while in the hand).
function Weapon:applyPose(t: CFrame?)
	if self.mode == "hand" then
		self.motor.Transform = t or CFrame.identity
	end
end

-- Edge glow: 0.35 idle .. ~2.6 mid-swing (same scale as the preview's emissive intensity).
function Weapon:setGlow(g: number)
	if math.abs(g - self.glow) < 0.01 then
		return
	end
	self.glow = g
	local k = math.clamp((g - 0.35) / 2.25, 0, 1)
	local transparency = 0.55 - 0.55 * k
	local color = EDGE:Lerp(EDGE_HOT, k)
	for _, e in ipairs(self.edges) do
		e.Transparency = transparency
		e.Color = color
	end
	self.light.Enabled = k > 0.15
	self.light.Brightness = k * 2.2
end

function Weapon:worldPoint(name: string): Vector3
	return self.attachments[name].WorldPosition
end

-- Local-only fade (first-person hides the body's own weapon, afterimages copy it).
function Weapon:setLocalTransparency(t: number)
	for _, d in ipairs(self.model:GetDescendants()) do
		if d:IsA("BasePart") then
			d.LocalTransparencyModifier = t
		end
	end
end

function Weapon:parts(): { BasePart }
	local out = {}
	for _, d in ipairs(self.model:GetDescendants()) do
		if d:IsA("BasePart") and d.Transparency < 1 then
			table.insert(out, d)
		end
	end
	return out
end

function Weapon:destroy()
	self.model:Destroy()
end

Weapon.VM_SCALE = WeaponData.VM_SCALE

return Weapon
