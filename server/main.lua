local ESX = exports['es_extended']:getSharedObject()
local useOx = GetResourceState('ox_inventory') == 'started'

local ShopById = {}
local Prices = {}
local NextRefresh = 0
local LastAction = {}
local LabelCache = {}
local RECEIPT_TABLE = 'len_sellpoints_receipts'

for _, shop in ipairs(Config.Shops) do
    ShopById[shop.id] = shop
end

local function ResolveLabel(name)
    if LabelCache[name] then return LabelCache[name] end

    local label
    if useOx then
        local ok, def = pcall(function() return exports.ox_inventory:Items(name) end)
        if ok and type(def) == 'table' and def.label then
            label = def.label
        end
    end

    if not label then
        local ok, row = pcall(MySQL.single.await, 'SELECT label FROM items WHERE name = ?', { name })
        if ok and row and row.label then
            label = row.label
        end
    end

    LabelCache[name] = label or name
    return LabelCache[name]
end

local function GetItemCount(src, name)
    if useOx then
        return exports.ox_inventory:Search(src, 'count', name) or 0
    end
    local xPlayer = ESX.GetPlayerFromId(src)
    local item = xPlayer and xPlayer.getInventoryItem(name)
    return item and item.count or 0
end

local function RemoveItem(src, name, amount)
    if useOx then
        return exports.ox_inventory:RemoveItem(src, name, amount) == true
    end
    local xPlayer = ESX.GetPlayerFromId(src)
    if not xPlayer then return false end
    xPlayer.removeInventoryItem(name, amount)
    return true
end

local function CanCarry(src, name, amount)
    if useOx then
        return exports.ox_inventory:CanCarryItem(src, name, amount) == true
    end
    local xPlayer = ESX.GetPlayerFromId(src)
    if not xPlayer then return false end
    if xPlayer.canCarryItem then
        return xPlayer.canCarryItem(name, amount) == true
    end
    return true
end

local function GiveReceipt(src, metadata)
    if useOx then
        local ok = exports.ox_inventory:AddItem(src, Config.ReceiptItem, 1, metadata)
        return ok ~= false
    end
    local xPlayer = ESX.GetPlayerFromId(src)
    if not xPlayer then return false end
    xPlayer.addInventoryItem(Config.ReceiptItem, 1)
    return true
end

local function OwnerOf(src)
    local xPlayer = ESX.GetPlayerFromId(src)
    return xPlayer and xPlayer.identifier or ('src:' .. tostring(src))
end

local function NewReceiptNumber()
    local number
    repeat
        number = string.format('%06d', math.random(100000, 999999))
    until not MySQL.scalar.await(('SELECT 1 FROM %s WHERE number = ?'):format(RECEIPT_TABLE), { number })
    return number
end

local function BuildReceipt(shop, lines, total)
    local number = NewReceiptNumber()
    local units = 0
    for _, l in ipairs(lines) do
        units = units + l.amount
    end
    return {
        shop = ShopName(shop),
        number = number,
        date = os.date('%d.%m.%Y %H:%M'),
        lines = lines,
        units = units,
        total = total,
        payment = 'cash',
        description = ('Nr. %s · %s%d'):format(number, Config.Currency, math.floor(total))
    }
end

local function StoreReceipt(receipt, owner)
    MySQL.insert.await(('INSERT INTO %s (number, owner, data) VALUES (?, ?, ?)'):format(RECEIPT_TABLE),
        { receipt.number, owner, json.encode(receipt) })
end

local function FindReceipt(src, number)
    local owner = OwnerOf(src)
    local row
    if type(number) == 'string' and number ~= '' then
        row = MySQL.single.await(('SELECT data FROM %s WHERE number = ? AND owner = ?'):format(RECEIPT_TABLE),
            { number, owner })
    else
        row = MySQL.single.await(('SELECT data FROM %s WHERE owner = ? ORDER BY id DESC LIMIT 1'):format(RECEIPT_TABLE),
            { owner })
    end
    if not row or not row.data then return nil end
    return json.decode(row.data)
end

local function ComputePrice(item, entry)
    local p = math.floor(entry.ref * (1 + entry.drift) + 0.5)
    return math.max(item.minPrice, math.min(item.maxPrice, p))
end

local function RefreshPrices()
    for _, shop in ipairs(Config.Shops) do
        Prices[shop.id] = Prices[shop.id] or {}
        for _, item in ipairs(shop.items) do
            local old = Prices[shop.id][item.name]
            local ref = math.random(item.minPrice, item.maxPrice)
            local entry = {
                ref = ref,
                drift = 0.0,
                raw = 0.0,
                price = ref,
                prev = old and old.price or ref
            }
            entry.price = ComputePrice(item, entry)
            Prices[shop.id][item.name] = entry
        end
    end
    NextRefresh = os.time() + Config.PriceRefreshMinutes * 60
end

local function Clamp(x, lo, hi)
    return math.max(lo, math.min(hi, x))
end

local function SoftLimit(raw)
    local soft = Config.SoftPriceDeviation
    local hard = Config.MaxPriceDeviation
    local a = math.abs(raw)
    if a <= soft then return raw end
    local limited = soft + (hard - soft) * (1 - math.exp(-(a - soft) / (hard - soft)))
    return raw < 0 and -limited or limited
end

local function MoveMarket(shopId, item, amount)
    local entry = Prices[shopId][item.name]
    local old = entry.price

    local impact = math.min(Config.SellPressure * amount, Config.MaxSaleImpact)
    entry.raw = Clamp(entry.raw - impact, -Config.MaxRawDeviation, Config.MaxRawDeviation)
    entry.drift = SoftLimit(entry.raw)

    entry.prev = old
    entry.price = ComputePrice(item, entry)
end

local function RecoverMarket()
    for _, shop in ipairs(Config.Shops) do
        for _, item in ipairs(shop.items) do
            local entry = Prices[shop.id][item.name]
            local old = entry.price

            entry.raw = entry.raw * Config.MarketReversion
                + (math.random() * 2 - 1) * Config.MarketNoise
            if math.random() < Config.EventChance then
                entry.raw = entry.raw + (math.random() < 0.5 and -1 or 1) * Config.EventKick
            end
            entry.raw = Clamp(entry.raw, -Config.MaxRawDeviation, Config.MaxRawDeviation)
            entry.drift = SoftLimit(entry.raw)

            entry.prev = old
            entry.price = ComputePrice(item, entry)
        end
    end
end

local function BuildShopData(src, shop)
    local items = {}
    for _, item in ipairs(shop.items) do
        local entry = Prices[shop.id][item.name]
        items[#items + 1] = {
            name = item.name,
            label = ResolveLabel(item.name),
            price = entry.price,
            prev = entry.prev,
            ref = entry.ref,
            min = item.minPrice,
            max = item.maxPrice,
            count = GetItemCount(src, item.name),
            black = item.blackMoney == true
        }
    end

    return {
        shop = { id = shop.id, name = ShopName(shop) },
        items = items,
        nextRefresh = math.max(0, NextRefresh - os.time())
    }
end

local function IsNear(src, shop)
    local ped = GetPlayerPed(src)
    if ped == 0 then return false end
    return #(GetEntityCoords(ped) - shop.coords) <= Config.InteractDistance + 2.5
end

local function RateLimited(src)
    local now = GetGameTimer()
    local last = LastAction[src]
    if last and now - last < Config.SellCooldown then
        return true
    end
    LastAction[src] = now
    return false
end

AddEventHandler('playerDropped', function()
    LastAction[source] = nil
end)

CreateThread(function()
    math.randomseed(os.time())

    if Config.ReceiptEnabled then
        MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS len_sellpoints_receipts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            number VARCHAR(6) NOT NULL UNIQUE,
            owner VARCHAR(100) NOT NULL,
            data LONGTEXT NOT NULL,
            created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (owner)
        )
    ]])
    end

    for _, shop in ipairs(Config.Shops) do
        for _, item in ipairs(shop.items) do
            ResolveLabel(item.name)
        end
    end

    RefreshPrices()

    while true do
        Wait(15000)
        if os.time() >= NextRefresh then
            RefreshPrices()
        else
            RecoverMarket()
        end
    end
end)

ESX.RegisterServerCallback('len_sellpoints:getData', function(src, cb, shopId)
    local shop = ShopById[shopId]
    if not shop then return cb({ error = 'err_load' }) end
    if not IsNear(src, shop) then return cb({ error = 'err_far' }) end
    cb(BuildShopData(src, shop))
end)

ESX.RegisterServerCallback('len_sellpoints:getReceipt', function(src, cb, number)
    if not Config.ReceiptEnabled then return cb(nil) end
    cb(FindReceipt(src, number))
end)

ESX.RegisterServerCallback('len_sellpoints:sell', function(src, cb, shopId, offer)
    local shop = ShopById[shopId]
    if not shop then return cb({ error = 'err_load' }) end
    if not IsNear(src, shop) then return cb({ error = 'err_far' }) end
    if RateLimited(src) then return cb({ error = 'err_cooldown' }) end
    if type(offer) ~= 'table' then return cb({ error = 'err_invalid' }) end

    local allowed = {}
    for _, item in ipairs(shop.items) do
        allowed[item.name] = item
    end

    local requested = {}
    local lines = 0
    for _, line in ipairs(offer) do
        lines = lines + 1
        if lines > Config.MaxCartLines or type(line) ~= 'table' then
            return cb({ error = 'err_invalid' })
        end
        local item = allowed[line.name]
        local amount = math.floor(tonumber(line.amount) or 0)
        if not item or amount < 1 then
            return cb({ error = 'err_invalid' })
        end
        requested[item.name] = (requested[item.name] or 0) + amount
    end

    local sale = {}
    for name, amount in pairs(requested) do
        if amount > Config.MaxSellAmount then
            return cb({ error = 'err_limit', vars = { max = Config.MaxSellAmount } })
        end
        if GetItemCount(src, name) < amount then
            return cb({ error = 'err_not_enough', vars = { item = ResolveLabel(name) } })
        end
        sale[#sale + 1] = { item = allowed[name], amount = amount }
    end

    if #sale == 0 then
        return cb({ error = 'err_empty' })
    end

    local xPlayer = ESX.GetPlayerFromId(src)
    if not xPlayer then return cb({ error = 'err_sell' }) end

    local receiptLines, earned, clean, dirty, sold = {}, 0, 0, 0, 0
    for _, s in ipairs(sale) do
        local unit = Prices[shop.id][s.item.name].price
        local total = unit * s.amount
        earned = earned + total
        sold = sold + s.amount
        if s.item.blackMoney then
            dirty = dirty + total
        else
            clean = clean + total
            receiptLines[#receiptLines + 1] = {
                label = ResolveLabel(s.item.name),
                amount = s.amount,
                unit = unit,
                total = total
            }
        end
    end

    if Config.ReceiptEnabled and #receiptLines > 0 and not CanCarry(src, Config.ReceiptItem, 1) then
        return cb({ error = 'err_no_space' })
    end

    for _, s in ipairs(sale) do
        if not RemoveItem(src, s.item.name, s.amount) then
            return cb({ error = 'err_sell' })
        end
    end

    if clean > 0 then xPlayer.addMoney(clean) end
    if dirty > 0 then xPlayer.addAccountMoney(Config.BlackMoneyAccount, dirty) end

    local receiptNo = nil
    if Config.ReceiptEnabled and #receiptLines > 0 then
        local receipt = BuildReceipt(shop, receiptLines, clean)
        receiptNo = receipt.number
        StoreReceipt(receipt, OwnerOf(src))
        GiveReceipt(src, receipt)
    end

    for _, s in ipairs(sale) do
        MoveMarket(shop.id, s.item, s.amount)
    end

    cb({
        ok = true,
        sold = sold,
        earned = earned,
        receiptNo = receiptNo,
        data = BuildShopData(src, shop)
    })
end)

if Config.ReceiptEnabled then
    local function ShowReceiptTo(src, receipt)
        TriggerClientEvent('len_sellpoints:showReceipt', src, receipt or {})
    end

    local function MetaFromUse(src, slot, data, item)
        for _, c in ipairs({ data, item }) do
            if type(c) == 'table' and type(c.metadata) == 'table' and c.metadata.number then
                return c.metadata
            end
        end

        local slotNum = type(slot) == 'table' and slot.slot or slot
        if type(slotNum) == 'number' then
            local ok, entry = pcall(function()
                return exports.ox_inventory:GetSlot(src, slotNum)
            end)
            if ok and type(entry) == 'table' and type(entry.metadata) == 'table' and entry.metadata.number then
                return entry.metadata
            end
        end

        return nil
    end

    exports('useReceipt', function(event, item, inventory, slot, data)
        if event ~= 'usingItem' then return end
        local src = type(inventory) == 'table' and inventory.id or inventory
        if type(src) ~= 'number' then return end

        local meta = MetaFromUse(src, slot, data, item)
        local receipt = FindReceipt(src, meta and meta.number or nil) or meta
        ShowReceiptTo(src, receipt)
        return true
    end)

    ESX.RegisterUsableItem(Config.ReceiptItem, function(src)
        ShowReceiptTo(src, FindReceipt(src, nil))
    end)
end
