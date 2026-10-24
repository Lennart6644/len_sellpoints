local ESX = exports['es_extended']:getSharedObject()

local isOpen = false
local activeShop = nil

local function Notify(key, vars)
    ESX.ShowNotification(L(key, vars))
end

local function Strings()
    return Locales[Config.Locale] or Locales.en
end

local function DrawText3D(x, y, z, text)
    local onScreen, sx, sy = World3dToScreen2d(x, y, z)
    if not onScreen then return end
    SetTextFont(4)
    SetTextProportional(true)
    SetTextScale(0.36, 0.36)
    SetTextColour(255, 255, 255, 230)
    SetTextCentre(true)
    SetTextOutline()
    BeginTextCommandDisplayText('STRING')
    AddTextComponentSubstringPlayerName(text)
    EndTextCommandDisplayText(sx, sy)
end

local function CloseShop()
    if not isOpen then return end
    isOpen = false
    activeShop = nil
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'close' })
end

local function OpenShop(shop)
    if isOpen then return end
    ESX.TriggerServerCallback('len_sellpoints:getData', function(data)
        if not data or data.error then
            return Notify(data and data.error or 'err_load', data and data.vars)
        end
        if isOpen then return end

        isOpen = true
        activeShop = shop
        SetNuiFocus(true, true)
        SendNUIMessage({
            action = 'open',
            data = data,
            locale = Config.Locale,
            currency = Config.Currency,
            limit = Config.MaxSellAmount,
            strings = Strings()
        })
    end, shop.id)
end

RegisterNUICallback('sell', function(body, cb)
    if not isOpen or not activeShop then
        return cb({ error = 'err_far' })
    end
    ESX.TriggerServerCallback('len_sellpoints:sell', function(res)
        cb(res)
    end, activeShop.id, body.cart)
end)

RegisterNUICallback('refresh', function(_, cb)
    if not isOpen or not activeShop then
        return cb({ error = 'err_far' })
    end
    ESX.TriggerServerCallback('len_sellpoints:getData', function(res)
        cb(res)
    end, activeShop.id)
end)

RegisterNUICallback('close', function(_, cb)
    CloseShop()
    cb('ok')
end)

RegisterNUICallback('closeReceipt', function(_, cb)
    SetNuiFocus(false, false)
    cb('ok')
end)

local function ExtractReceiptMeta(data, depth)
    depth = depth or 0
    if type(data) ~= 'table' or depth > 3 then return nil end
    if data.number or data.lines then return data end
    for _, key in ipairs({ 'metadata', 'info', 'data' }) do
        local found = ExtractReceiptMeta(data[key], depth + 1)
        if found then return found end
    end
    return nil
end

local function ShowReceipt(receipt)
    SendNUIMessage({
        action = 'receipt',
        receipt = receipt or {},
        locale = Config.Locale,
        currency = Config.Currency,
        strings = Strings()
    })
end

RegisterNetEvent('len_sellpoints:useReceipt', function(data)
    if not Config.ReceiptEnabled then return end
    if isOpen then CloseShop() end

    local meta = ExtractReceiptMeta(data)
    local number = meta and meta.number or false
    SetNuiFocus(true, true)

    ESX.TriggerServerCallback('len_sellpoints:getReceipt', function(stored)
        ShowReceipt(stored or meta)
    end, number)
end)

CreateThread(function()
    for _, shop in ipairs(Config.Shops) do
        if shop.blip then
            local blip = AddBlipForCoord(shop.coords.x, shop.coords.y, shop.coords.z)
            SetBlipSprite(blip, shop.blip.sprite)
            SetBlipColour(blip, shop.blip.color)
            SetBlipScale(blip, 0.8)
            SetBlipAsShortRange(blip, true)
            BeginTextCommandSetBlipName('STRING')
            AddTextComponentString(ShopName(shop))
            EndTextCommandSetBlipName(blip)
        end
    end
end)

CreateThread(function()
    while true do
        local sleep = 1000
        local coords = GetEntityCoords(PlayerPedId())

        for _, shop in ipairs(Config.Shops) do
            local dist = #(coords - shop.coords)

            if dist < Config.DrawDistance then
                sleep = 0

                if Config.Marker.enabled then
                    local m = Config.Marker
                    DrawMarker(m.type, shop.coords.x, shop.coords.y, shop.coords.z + m.offset,
                        0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                        m.scale.x, m.scale.y, m.scale.z,
                        m.color.r, m.color.g, m.color.b, m.color.a,
                        false, false, 2, false, nil, nil, false)
                end

                if isOpen and activeShop and activeShop.id == shop.id then
                    if dist > Config.InteractDistance + 3.0 then
                        CloseShop()
                        Notify('err_far')
                    end
                elseif not isOpen and dist < Config.InteractDistance then
                    DrawText3D(shop.coords.x, shop.coords.y, shop.coords.z + 1.0,
                        L('interact', { action = L('open_shop') }))
                    if IsControlJustPressed(0, 38) then
                        OpenShop(shop)
                    end
                end
            end
        end

        Wait(sleep)
    end
end)

RegisterNetEvent('len_sellpoints:showReceipt', function(receipt)
    if not Config.ReceiptEnabled then return end
    if isOpen then CloseShop() end
    SetNuiFocus(true, true)
    ShowReceipt(receipt)
end)
