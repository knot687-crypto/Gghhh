--[[
	Screen layer: anime speed lines at high speed, a first-person crosshair and a controls card
	(toggle with H).
]]

local Players = game:GetService("Players")
local UserInputService = game:GetService("UserInputService")

local AAAMotion = game:GetService("ReplicatedStorage"):WaitForChild("AAAMotion")
local Config = require(AAAMotion.Config)

local HUD = {}
HUD.__index = HUD

local LINES = 56

local CONTROLS = {
	{ "WASD", "Move" },
	{ "Shift", "Sprint" },
	{ "Space", "Jump / double jump / wall jump" },
	{ "Ctrl / C", "Crouch, slide while sprinting" },
	{ "Q", "Dash (also in the air)" },
	{ "Run into walls", "Wall run, vault, mantle (Space)" },
	{ "LMB", "Slash combo (air: plunge)" },
	{ "RMB hold", "Charged heavy" },
	{ "F hold", "Block - tap on impact to parry" },
	{ "R", "Lunge" },
	{ "E", "Draw / sheath" },
	{ "V", "First / third person" },
	{ "Alt", "Free the mouse" },
}

function HUD.new()
	local self = setmetatable({}, HUD)
	local gui = Instance.new("ScreenGui")
	gui.Name = "AAAMotionHUD"
	gui.IgnoreGuiInset = true
	gui.ResetOnSpawn = false
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
	gui.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")
	self.gui = gui

	local lines = Instance.new("Frame")
	lines.Name = "SpeedLines"
	lines.BackgroundTransparency = 1
	lines.Size = UDim2.fromScale(1, 1)
	lines.Parent = gui
	self.lines = {}
	local rng = Random.new(7)
	for i = 1, LINES do
		local a = rng:NextNumber() * math.pi * 2
		local f = Instance.new("Frame")
		f.BorderSizePixel = 0
		f.BackgroundColor3 = Color3.new(1, 1, 1)
		f.BackgroundTransparency = 1
		f.AnchorPoint = Vector2.new(0.5, 0.5)
		f.Rotation = math.deg(a) + 90
		f.Parent = lines
		self.lines[i] = { frame = f, a = a, r = 0.42 + rng:NextNumber() * 0.25, l = 0.2 + rng:NextNumber() * 0.35, w = 1 + rng:NextNumber() * 3, s = rng:NextNumber() }
	end
	self.speedLines = 0

	local dot = Instance.new("Frame")
	dot.Name = "Crosshair"
	dot.Size = UDim2.fromOffset(4, 4)
	dot.AnchorPoint = Vector2.new(0.5, 0.5)
	dot.Position = UDim2.fromScale(0.5, 0.5)
	dot.BackgroundColor3 = Color3.new(1, 1, 1)
	dot.BackgroundTransparency = 0.2
	dot.BorderSizePixel = 0
	dot.Visible = false
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(1, 0)
	corner.Parent = dot
	dot.Parent = gui
	self.crosshair = dot

	self.card = self:buildCard()
	self.card.Visible = not UserInputService.TouchEnabled
	task.delay(12, function()
		self.card.Visible = false
	end)
	UserInputService.InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.H then
			self.card.Visible = not self.card.Visible
		end
	end)
	return self
end

function HUD:buildCard(): Frame
	local card = Instance.new("Frame")
	card.Name = "Controls"
	card.AnchorPoint = Vector2.new(0, 0.5)
	card.Position = UDim2.new(0, 18, 0.5, 0)
	card.Size = UDim2.fromOffset(330, 34 + #CONTROLS * 22)
	card.BackgroundColor3 = Color3.fromRGB(8, 12, 22)
	card.BackgroundTransparency = 0.35
	card.BorderSizePixel = 0
	card.Parent = self.gui
	local accent = Instance.new("Frame")
	accent.Size = UDim2.new(0, 4, 1, 0)
	accent.BackgroundColor3 = Color3.fromHex("#46c8ff")
	accent.BorderSizePixel = 0
	accent.Parent = card
	local title = Instance.new("TextLabel")
	title.BackgroundTransparency = 1
	title.Position = UDim2.fromOffset(16, 6)
	title.Size = UDim2.new(1, -24, 0, 22)
	title.Font = Enum.Font.GothamBold
	title.TextSize = 16
	title.TextColor3 = Color3.new(1, 1, 1)
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.Text = "AAA MOTION  -  H to hide"
	title.Parent = card
	for i, row in ipairs(CONTROLS) do
		local key = Instance.new("TextLabel")
		key.BackgroundTransparency = 1
		key.Position = UDim2.fromOffset(16, 8 + i * 22)
		key.Size = UDim2.fromOffset(110, 20)
		key.Font = Enum.Font.GothamBold
		key.TextSize = 13
		key.TextColor3 = Color3.fromHex("#9fe9ff")
		key.TextXAlignment = Enum.TextXAlignment.Left
		key.Text = row[1]
		key.Parent = card
		local label = key:Clone()
		label.Position = UDim2.fromOffset(128, 8 + i * 22)
		label.Size = UDim2.fromOffset(196, 20)
		label.Font = Enum.Font.Gotham
		label.TextColor3 = Color3.fromRGB(214, 232, 255)
		label.Text = row[2]
		label.Parent = card
	end
	return card
end

-- intensity 0..1 of the speed lines; fp toggles the crosshair.
function HUD:update(dt: number, intensity: number, fp: boolean)
	self.crosshair.Visible = fp
	self.speedLines += (intensity - self.speedLines) * math.min(1, dt * 10)
	local k = if Config.Graphics.speedLines then self.speedLines else 0
	local cam = workspace.CurrentCamera
	local vs = cam.ViewportSize
	local half = math.sqrt(vs.X * vs.X + vs.Y * vs.Y) * 0.5
	local t = os.clock()
	for _, ln in ipairs(self.lines) do
		local f = ln.frame
		local flick = (math.sin(t * 40 + ln.s * 50) + 1) / 2
		if k < 0.01 or flick < 0.35 then
			f.BackgroundTransparency = 1
		else
			local r0 = ln.r * half
			local len = ln.l * half
			local mid = r0 + len / 2
			f.Size = UDim2.fromOffset(ln.w * (vs.Y / 720), len)
			f.Position = UDim2.fromOffset(vs.X / 2 + math.cos(ln.a) * mid, vs.Y / 2 + math.sin(ln.a) * mid)
			f.BackgroundTransparency = 1 - 0.2 * k * flick
		end
	end
end

return HUD
