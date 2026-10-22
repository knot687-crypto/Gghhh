--[[
	Dash afterimages: glowing, fading copies of a character's current pose.
	Copies are anchored, non-colliding clones of the visible parts (MeshParts keep their mesh,
	accessory handles keep their SpecialMesh) recoloured as translucent neon.
]]

local Config = require(script.Parent.Parent.Config)
local Effects = require(script.Parent.Effects)

local Afterimage = {}

local live = 0

local function strip(p: BasePart)
	for _, c in ipairs(p:GetChildren()) do
		if c:IsA("DataModelMesh") then
			if c:IsA("SpecialMesh") then
				c.TextureId = ""
			end
		else
			c:Destroy()
		end
	end
end

--[[
	parts   visible BaseParts to copy (character body, accessories, weapon)
	opts    { life = 0.32, color = Color3, transparency = 0.58 }
]]
function Afterimage.spawn(parts: { BasePart }, opts)
	if not Config.Graphics.afterimages then
		return
	end
	local o = opts or {}
	if live + #parts > (Config.Graphics.maxAfterimageParts or 260) then
		return
	end
	local life = o.life or 0.32
	local color = o.color or Color3.fromRGB(88, 207, 255)
	local t0 = o.transparency or 0.58
	local model = Instance.new("Model")
	model.Name = "AAAAfterimage"
	local copies = {}
	for _, src in ipairs(parts) do
		if src.Transparency < 0.95 then
			local ok, c = pcall(function()
				return src:Clone()
			end)
			if ok and c then
				local p = c :: BasePart
				strip(p)
				p.Anchored = true
				p.CanCollide = false
				p.CanQuery = false
				p.CanTouch = false
				p.Massless = true
				p.CastShadow = false
				p.Material = Enum.Material.Neon
				p.Color = color
				p.Reflectance = 0
				p.Transparency = t0
				p.CFrame = src.CFrame
				if p:IsA("MeshPart") then
					pcall(function()
						(p :: MeshPart).TextureID = ""
					end)
				end
				p.Parent = model
				table.insert(copies, p)
			end
		end
	end
	if #copies == 0 then
		model:Destroy()
		return
	end
	live += #copies
	model.Parent = require(script.Parent.Parent.Combat.Weapon).localFolder()
	Effects.addTimed(life, function(k)
		local tr = 1 - (1 - t0) * (1 - k) ^ 1.6
		for _, p in ipairs(copies) do
			p.Transparency = tr
		end
	end, function()
		live -= #copies
		model:Destroy()
	end)
end

-- Visible parts of a character model plus optional extra parts (its weapon).
function Afterimage.partsOf(model: Model, extra: { BasePart }?): { BasePart }
	local out = {}
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("BasePart") and d.Name ~= "HumanoidRootPart" and d.Transparency < 0.95 then
			table.insert(out, d)
		end
	end
	if extra then
		for _, p in ipairs(extra) do
			table.insert(out, p)
		end
	end
	return out
end

return Afterimage
