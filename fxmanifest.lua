fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'len_sellpoints'
author 'Lennart'
description 'Sellpoints with cart system, dynamic market prices, DE/EN and modern NUI'
version '2.1.0'

dependencies {
    'es_extended',
    'oxmysql'
}

shared_scripts {
    'config.lua',
    'locales/de.lua',
    'locales/en.lua'
}

client_scripts {
    'client/main.lua'
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'server/main.lua'
}

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js'
}
