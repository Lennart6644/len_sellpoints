Config = {}

Config.Locale = 'en'
Config.Currency = '$'
Config.BlackMoneyAccount = 'black_money'
Config.ImagePath = 'nui://ox_inventory/web/images/%s.png'

Config.InteractDistance = 1.5
Config.DrawDistance = 25.0

Config.Marker = {
    enabled = true,
    type = 1,
    scale = { x = 1.1, y = 1.1, z = 0.25 },
    color = { r = 0, g = 200, b = 255, a = 110 },
    offset = -0.95
}

Config.PriceRefreshMinutes = 30

Config.SoftPriceDeviation = 0.04
Config.MaxPriceDeviation = 0.075
Config.MaxRawDeviation = 0.12
Config.SellPressure = 0.0005
Config.MaxSaleImpact = 0.02
Config.MarketNoise = 0.002
Config.MarketReversion = 0.99
Config.EventChance = 0.01
Config.EventKick = 0.025

Config.MaxSellAmount = 500
Config.MaxCartLines = 40
Config.SellCooldown = 750
Config.ReceiptEnabled = true
Config.ReceiptItem = 'printed_receipt'

Config.Shops = {
    {
		id = 'fish_market',
		name = { de = 'Fischmarkt', en = 'Fish Market' },
		coords = vector3(-1592.6915, 5199.0234, 4.3590),
		items = {
			{ name = 'fish_anchovy', minPrice = 80, maxPrice = 110, blackMoney = false },
			{ name = 'fish_sardine', minPrice = 85, maxPrice = 115, blackMoney = false },
			{ name = 'fish_mackerel', minPrice = 115, maxPrice = 165, blackMoney = false },
			{ name = 'fish_herring', minPrice = 130, maxPrice = 170, blackMoney = false },
			{ name = 'fish_sea_bream', minPrice = 235, maxPrice = 320, blackMoney = false },
			{ name = 'fish_parrotfish', minPrice = 165, maxPrice = 210, blackMoney = false },
			{ name = 'fish_clownfish', minPrice = 140, maxPrice = 195, blackMoney = false },
			{ name = 'fish_triggerfish', minPrice = 235, maxPrice = 320, blackMoney = false },
			{ name = 'fish_lionfish', minPrice = 280, maxPrice = 355, blackMoney = false },
			{ name = 'fish_moray_eel', minPrice = 320, maxPrice = 420, blackMoney = false },
			{ name = 'fish_lanternfish', minPrice = 190, maxPrice = 255, blackMoney = false },
			{ name = 'fish_viperfish', minPrice = 225, maxPrice = 305, blackMoney = false },
			{ name = 'fish_gulper_eel', minPrice = 505, maxPrice = 675, blackMoney = false },
			{ name = 'fish_anglerfish', minPrice = 540, maxPrice = 730, blackMoney = false },
			{ name = 'fish_oarfish', minPrice = 710, maxPrice = 945, blackMoney = false },
			{ name = 'fish_barracuda', minPrice = 255, maxPrice = 340, blackMoney = false },
			{ name = 'fish_tuna', minPrice = 370, maxPrice = 505, blackMoney = false },
			{ name = 'fish_mahi_mahi', minPrice = 440, maxPrice = 575, blackMoney = false },
			{ name = 'fish_blacktip_shark', minPrice = 640, maxPrice = 845, blackMoney = false },
			{ name = 'fish_marlin', minPrice = 1015, maxPrice = 1350, blackMoney = false },
			{ name = 'fish_golden_tuna', minPrice = 3375, maxPrice = 5065, blackMoney = true },
			{ name = 'fish_crystal_sturgeon', minPrice = 4050, maxPrice = 6075, blackMoney = true },
			{ name = 'fish_ancient_coelacanth', minPrice = 4725, maxPrice = 7090, blackMoney = true },
			{ name = 'fish_phantom_ray', minPrice = 5400, maxPrice = 8100, blackMoney = true },
			{ name = 'fish_sea_king_carp', minPrice = 6750, maxPrice = 10125, blackMoney = true }
		},
		blip = { sprite = 141, color = 2 }
	}
}

Locales = {}

function L(key, vars)
    local dict = Locales[Config.Locale] or Locales.en or {}
    local str = dict[key] or key
    if vars then
        for k, v in pairs(vars) do
            str = str:gsub('{' .. k .. '}', function() return tostring(v) end)
        end
    end
    return str
end

function ShopName(shop)
    if type(shop.name) == 'table' then
        return shop.name[Config.Locale] or shop.name.en
    end
    return shop.name
end
