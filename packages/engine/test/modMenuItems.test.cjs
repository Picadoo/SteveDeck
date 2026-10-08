const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dragonMenu,refreshDragonMenu,inventoryItem,applyCursorPacket,clickDragonInventorySlot } = require('../src/modules/mod_menu_items');
const { EventEmitter } = require('node:events');

test('龙核心背包、装备槽和鼠标内容同属一个快照，旧物品数据不会当作新回执',()=>{
    const inst={bot:{inventory:{slots:[],selectedItem:null}},_vexMenuState:{dragonConfigs:{'gui/test.yml':{text:'法宝_slot:\n  identifier: 法宝槽位\n背包_slot:\n  identifier: container_9\n非法_slot:\n  identifier: container_999'}},dragonSlots:{'法宝槽位':{at:10,data:Buffer.from([255,255]).toString('base64')}}}};
    const menu=dragonMenu(inst,'test');
    assert.equal(menu.slots[0].label,'法宝');assert.equal(menu.slots[0].loaded,true);
    assert.equal(menu.slots[1].clickable,true);assert.equal(menu.slots[2].clickable,false);
    assert.equal(refreshDragonMenu(inst,{...menu,requestedAt:11}).slots[0].loaded,false);
    inst.bot.inventory.selectedItem={type:1,metadata:0,count:2,name:'stone',displayName:'Stone'};
    assert.equal(refreshDragonMenu(inst,menu).cursor.count,2);
    assert.notEqual(inventoryItem(inst.bot.inventory.selectedItem).fingerprint,inventoryItem({...inst.bot.inventory.selectedItem,count:1}).fingerprint);
});

test('自定义槽发来的光标物品包更新鼠标，空物品包清空鼠标',()=>{
    const bot={version:'1.12.2',inventory:{selectedItem:null}};
    applyCursorPacket(bot,{windowId:-1,slot:-1,item:{blockId:1,itemCount:2,itemDamage:0,nbtData:null}});
    assert.equal(bot.inventory.selectedItem.count,2);
    applyCursorPacket(bot,{windowId:-1,slot:-1,item:{blockId:-1}});
    assert.equal(bot.inventory.selectedItem,null);
});

test('背包交易失败不自动重试，并恢复服务器给出的鼠标内容',async()=>{
    let calls=0;const bot={version:'1.12.2',_client:new EventEmitter(),inventory:{slots:Array(46),selectedItem:null,updateSlot(){}}};
    bot.clickWindow=async()=>{calls++;bot._client.emit('set_slot',{windowId:-1,slot:-1,item:{blockId:1,itemCount:3,itemDamage:0,nbtData:null}});throw Error('Server rejected transaction');};
    await assert.rejects(clickDragonInventorySlot({bot},9,0),/Server rejected transaction/);
    assert.equal(calls,1);assert.equal(bot.inventory.selectedItem.count,3);
    assert.equal(bot._client.listenerCount('set_slot'),0);
    await assert.rejects(clickDragonInventorySlot({bot},999,0),/槽位已变化/);
    assert.equal(calls,1);
});
