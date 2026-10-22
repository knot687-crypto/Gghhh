--[[
	Demo arena built from Generated/Layout: the same floor, vault rail, mantle block, wall-run
	wall and drop tower the preview videos use, plus dusk lighting and post effects.
	Skipped when the place already has a Workspace.AAAArena model (bring your own map).
]]

local Lighting = game:GetService("Lighting")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local Layout = require(AAAMotion.Generated.Layout)

local Arena = {}

local MATERIAL = {
	stone = { Enum.Material.Slate, Color3.fromRGB(92, 90, 96) },
	floor = { Enum.Material.Concrete, Color3.fromRGB(122, 120, 126) },
	wood = { Enum.Material.WoodPlanks, Color3.fromRGB(122, 86, 52) },
}

local function part(props): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	return p
end

local function lantern(parent: Instance, pos: Vector3)
	local post = part({ Name = "LanternPost", Size = Vector3.new(0.6, 7, 0.6), Position = pos + Vector3.new(0, 3.5, 0), Color = Color3.fromRGB(40, 32, 28), Material = Enum.Material.Wood })
	post.Parent = parent
	local lamp = part({ Name = "Lantern", Size = Vector3.new(1.4, 1.8, 1.4), Position = pos + Vector3.new(0, 7.6, 0), Color = Color3.fromRGB(255, 176, 92), Material = Enum.Material.Neon, Transparency = 0.15 })
	lamp.Parent = parent
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 170, 90)
	light.Range = 22
	light.Brightness = 1.4
	light.Shadows = true
	light.Parent = lamp
end

function Arena.build()
	if workspace:FindFirstChild("AAAArena") then
		return
	end
	local model = Instance.new("Model")
	model.Name = "AAAArena"
	local fl = Layout.floor
	local floor = part({
		Name = "Floor",
		Size = Vector3.new(fl.size[1], fl.size[2], fl.size[3]),
		Position = Vector3.new(0, fl.top - fl.size[2] / 2, 0),
		Material = MATERIAL.floor[1],
		Color = MATERIAL.floor[2],
	})
	floor.Parent = model
	for _, b in ipairs(Layout.boxes) do
		local m = MATERIAL[b.material] or MATERIAL.stone
		local p = part({
			Name = b.name,
			Size = Vector3.new(b.size[1], b.size[2], b.size[3]),
			Position = Vector3.new(b.center[1], b.center[2], b.center[3]),
			Material = m[1],
			Color = m[2],
		})
		p.Parent = model
		-- Trim along the top edge reads the ledge from a distance.
		local trim = part({
			Name = b.name .. "Trim",
			Size = Vector3.new(b.size[1] + 0.1, 0.25, b.size[3] + 0.1),
			Position = Vector3.new(b.center[1], b.center[2] + b.size[2] / 2 - 0.12, b.center[3]),
			Material = Enum.Material.Metal,
			Color = Color3.fromRGB(70, 66, 62),
			CanCollide = false,
		})
		trim.Parent = model
	end
	-- A ring of lanterns around the sparring ground.
	for i = 0, 7 do
		local a = i / 8 * math.pi * 2
		lantern(model, Vector3.new(math.cos(a) * 34, 0, -100 + math.sin(a) * 34))
	end
	local sp = Layout.spawn
	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "AAASpawn"
	spawn.Anchored = true
	spawn.Size = Vector3.new(8, 0.4, 8)
	spawn.Position = Vector3.new(sp.position[1], sp.position[2] + 0.2, sp.position[3])
	spawn.Material = Enum.Material.Slate
	spawn.Color = Color3.fromRGB(70, 74, 86)
	spawn.Duration = 0
	spawn.Neutral = true
	spawn.Parent = model
	model.Parent = workspace

	Arena.lighting()
end

-- Dusk look matching the preview grade. Technology = Future is set in the Rojo project.
function Arena.lighting()
	Lighting.ClockTime = 17.6
	Lighting.GeographicLatitude = 25
	Lighting.Brightness = 2.6
	Lighting.EnvironmentDiffuseScale = 0.6
	Lighting.EnvironmentSpecularScale = 0.8
	Lighting.Ambient = Color3.fromRGB(38, 40, 52)
	Lighting.OutdoorAmbient = Color3.fromRGB(96, 98, 120)
	Lighting.ShadowSoftness = 0.15
	local function ensure(class: string, name: string)
		local e = Lighting:FindFirstChild(name)
		if not e then
			e = Instance.new(class)
			e.Name = name
			e.Parent = Lighting
		end
		return e
	end
	local atmo = ensure("Atmosphere", "AAAAtmosphere") :: Atmosphere
	atmo.Density = 0.32
	atmo.Offset = 0.12
	atmo.Color = Color3.fromRGB(199, 170, 155)
	atmo.Decay = Color3.fromRGB(92, 60, 72)
	atmo.Glare = 0.35
	atmo.Haze = 1.6
	local bloom = ensure("BloomEffect", "AAABloom") :: BloomEffect
	bloom.Intensity = 0.7
	bloom.Size = 30
	bloom.Threshold = 1.05
	local cc = ensure("ColorCorrectionEffect", "AAABaseGrade") :: ColorCorrectionEffect
	cc.Contrast = 0.12
	cc.Saturation = 0.08
	cc.TintColor = Color3.fromRGB(255, 246, 240)
	local rays = ensure("SunRaysEffect", "AAASunRays") :: SunRaysEffect
	rays.Intensity = 0.05
	rays.Spread = 0.6
end

return Arena
