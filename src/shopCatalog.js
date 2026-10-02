// 採買清單的知識庫：「這樣東西可以去哪一類店買」跟「這間店算哪一類」。
// 刻意寫成純資料、不 import config.js（那邊用到 import.meta.env），node 也能直接載入測試。
// 判斷不準的地方使用者可以在清單上直接改類別，改過的會記住（見 shoppingList.js 的 learned）。

// Places API 的 primaryType 落在這些類型（餐廳、學校、醫院…）的地方不可能是要找的店，
// 文字搜尋（例如「文具店」）偶爾會混進名字很像但其實是別的東西的地點，用這個濾掉
const NON_SHOP_TYPE_RE = /restaurant|cafe|coffee|(^|_)bar$|pub$|meal_|food_court|school|university|college|hospital|doctor|dentist|dental|clinic|lodging|hotel|hostel|park$|parking|church|temple|mosque|worship|government|city_hall|police|fire_station|corporate_office|apartment|housing|station$/;

function isNonShop(place) {
  return NON_SHOP_TYPE_RE.test(place.primaryType || '');
}

// 藥局跟藥妝店在 Google 上的類型常常混在一起（屈臣氏可能被標成 pharmacy、街角藥局被標成 drugstore），
// 所以兩類共用同一次搜尋，再用店名把「真的有藥師、買得到藥」的藥局，跟賣保養化妝品的藥妝店分開
const PHARMACY_NAME_RE = /藥局|藥房|藥師|藥行|藥品|健保特約|調劑|pharmacy|大樹|杏一|丁丁|躍獅|佑全|啄木鳥|醫療用品|醫療器材|醫材/;
const COSMETIC_NAME_RE = /屈臣氏|watsons|康是美|cosmed|寶雅|poya|松本清|matsumoto|日藥本舖|札幌|唐吉訶德|美華泰|tomods|莎莎|sasa|藥妝|藥粧|美妝|彩妝|sephora|innisfree|lush|thebodyshop/;

function isPharmacy(place) {
  if (PHARMACY_NAME_RE.test(place.nameKey)) return true;
  return place.primaryType === 'pharmacy' && !COSMETIC_NAME_RE.test(place.nameKey);
}

function isDrugstore(place) {
  if (COSMETIC_NAME_RE.test(place.nameKey)) return true;
  return ['drugstore', 'cosmetics_store'].includes(place.primaryType) && !PHARMACY_NAME_RE.test(place.nameKey);
}

// 每個類別怎麼找附近的店：
//   search.primaryTypes → Nearby Search 的 includedPrimaryTypes（店家「主要類型」符合才算，最準）
//   search.types        → Nearby Search 的 includedTypes（店家任一類型符合就算，例如加油站裡的便利商店）
//   search.query        → Text Search（Google 沒有對應類型的店，例如文具店、傳統市場，用中文關鍵字找）
// search.key 相同的類別共用同一次搜尋（藥局／藥妝店），再用 accept 判斷店家各自屬於哪一類。
// hint 會出現在修改類別的選單上，也會一起交給 AI 判斷沒收錄的品項
export const SHOP_CATEGORIES = [
  { id: 'convenience', label: '便利商店', emoji: '🏪', hint: '7-11、全家：飲料零食、簡單日用品、繳費取貨',
    search: { key: 'convenience', types: ['convenience_store'] } },
  { id: 'supermarket', label: '超市・量販', emoji: '🛒', hint: '全聯、家樂福、好市多：食材、調味料、清潔用品、日用品',
    search: { key: 'supermarket', primaryTypes: ['supermarket', 'grocery_store', 'hypermarket', 'discount_supermarket', 'warehouse_store'] } },
  { id: 'pharmacy', label: '藥局', emoji: '💊', hint: '藥局：成藥、保健食品、醫療用品、奶粉尿布',
    search: { key: 'health', primaryTypes: ['pharmacy', 'drugstore', 'cosmetics_store'] }, accept: isPharmacy },
  { id: 'drugstore', label: '藥妝店', emoji: '🧴', hint: '屈臣氏、康是美、寶雅：保養品、化妝品、洗沐用品',
    search: { key: 'health', primaryTypes: ['pharmacy', 'drugstore', 'cosmetics_store'] }, accept: isDrugstore },
  { id: 'home', label: '生活百貨', emoji: '🏠', hint: '寶雅、大創、IKEA、NITORI：收納、廚具、寢具、居家雜貨',
    search: { key: 'home', primaryTypes: ['home_goods_store', 'discount_store', 'general_store', 'furniture_store', 'department_store'] } },
  { id: 'hardware', label: '五金行', emoji: '🔧', hint: '五金行、特力屋：工具、螺絲、燈泡、水電材料',
    search: { key: 'hardware', primaryTypes: ['hardware_store', 'home_improvement_store', 'building_materials_store'] } },
  { id: 'market', label: '傳統市場', emoji: '🥬', hint: '菜市場：蔬菜、肉、海鮮、水果',
    search: { key: 'market', query: '傳統市場' }, accept: p => /市場|市集|菜市/.test(p.nameKey) && !isNonShop(p) },
  { id: 'fruit', label: '水果行', emoji: '🍎', hint: '水果',
    search: { key: 'fruit', query: '水果行' }, accept: p => /水果|果菜|青果|蔬果|果行|果園/.test(p.nameKey) && !isNonShop(p) },
  { id: 'bakery', label: '麵包店', emoji: '🥐', hint: '麵包、吐司、蛋糕',
    search: { key: 'bakery', primaryTypes: ['bakery'] } },
  { id: 'stationery', label: '文具店', emoji: '✏️', hint: '文具店、書局：筆、本子、紙類、辦公用品',
    search: { key: 'stationery', query: '文具店' }, accept: p => !isNonShop(p) },
  { id: 'book', label: '書店', emoji: '📚', hint: '書、雜誌、漫畫',
    search: { key: 'book', primaryTypes: ['book_store'] } },
  { id: 'electronics', label: '3C 家電', emoji: '🔌', hint: '燦坤、全國電子、通訊行：3C、家電、手機配件',
    search: { key: 'electronics', primaryTypes: ['electronics_store', 'cell_phone_store'] } },
  { id: 'pet', label: '寵物用品', emoji: '🐾', hint: '飼料、貓砂、寵物用品',
    search: { key: 'pet', primaryTypes: ['pet_store'] } },
  { id: 'baby', label: '婦嬰用品', emoji: '🍼', hint: '奶粉、尿布、嬰兒用品',
    search: { key: 'baby', query: '婦嬰用品' }, accept: p => !isNonShop(p) },
  { id: 'clothing', label: '服飾', emoji: '👕', hint: '衣服、內衣褲、襪子',
    search: { key: 'clothing', primaryTypes: ['clothing_store'] } },
  { id: 'shoes', label: '鞋店', emoji: '👟', hint: '鞋子',
    search: { key: 'shoes', primaryTypes: ['shoe_store'] } },
  { id: 'sports', label: '運動用品', emoji: '⚽', hint: '運動、健身、露營用品',
    search: { key: 'sports', primaryTypes: ['sporting_goods_store', 'sportswear_store'] } },
  { id: 'optical', label: '眼鏡行', emoji: '👓', hint: '眼鏡、隱形眼鏡',
    search: { key: 'optical', query: '眼鏡行' }, accept: p => !isNonShop(p) && /眼鏡|視光|鏡片|optical|optic|eyewear/.test(p.nameKey) },
  { id: 'florist', label: '花店', emoji: '💐', hint: '鮮花、花束、盆栽',
    search: { key: 'florist', primaryTypes: ['florist'] } },
  { id: 'toys', label: '玩具店', emoji: '🧸', hint: '玩具、模型、桌遊',
    search: { key: 'toys', query: '玩具店' }, accept: p => !isNonShop(p) },
  { id: 'liquor', label: '酒類專賣', emoji: '🍷', hint: '各種酒',
    search: { key: 'liquor', primaryTypes: ['liquor_store'] } },
  { id: 'bike', label: '自行車行', emoji: '🚲', hint: '自行車與零件',
    search: { key: 'bike', primaryTypes: ['bicycle_store'] } },
  { id: 'scooter', label: '機車行', emoji: '🛵', hint: '機油、輪胎、機車保養與用品',
    search: { key: 'scooter', query: '機車行' }, accept: p => !isNonShop(p) },
  { id: 'auto', label: '汽車百貨', emoji: '🚗', hint: '汽車用品、零件',
    search: { key: 'auto', types: ['auto_parts_store'] } },
  { id: 'gas', label: '加油站', emoji: '⛽', hint: '加油',
    search: { key: 'gas', primaryTypes: ['gas_station'] } },
  { id: 'post', label: '郵局', emoji: '📮', hint: '寄信、寄包裹、郵票',
    search: { key: 'post', primaryTypes: ['post_office'] } },
  { id: 'atm', label: 'ATM・銀行', emoji: '🏧', hint: '提款、匯款、換外幣',
    search: { key: 'atm', types: ['atm', 'bank'] } }
];

// 2023 年 Places API (New) 上線時就有的類型。上面有幾個是之後才加的新類型（hypermarket、cosmetics_store…），
// 萬一 Google 回 400 說不認得，就退回只用這份清單裡的類型重查，不要讓整個類別直接查不到
export const SAFE_PLACE_TYPES = new Set([
  'convenience_store', 'supermarket', 'grocery_store', 'pharmacy', 'drugstore', 'home_goods_store', 'discount_store',
  'furniture_store', 'department_store', 'hardware_store', 'home_improvement_store', 'bakery', 'book_store',
  'electronics_store', 'cell_phone_store', 'pet_store', 'clothing_store', 'shoe_store', 'sporting_goods_store',
  'florist', 'liquor_store', 'bicycle_store', 'auto_parts_store', 'gas_station', 'post_office', 'atm', 'bank', 'market'
]);

// 品項關鍵字 → 可以去哪幾類店買（前面的比較常見）。品項只要「包含」關鍵字就算，
// 同一個品項對到好幾個關鍵字時，最長的優先（「貓罐頭」是寵物用品，不會因為含「罐頭」被當成超市），
// 所以收錄夠具體的詞就能壓過容易誤判的短詞。關鍵字至少兩個字；單一字的放在下面 SINGLE_CHAR_RULES 當最後手段
export const ITEM_KEYWORD_RULES = [
  // ── 便利商店就能搞定的雜事 ──
  ['convenience', '便利商店 超商 小七 繳費 繳帳單 帳單 電話費 手機費 電信費 電費 水費 瓦斯費 停車費 罰單 罰款 牌照稅 燃料稅 健保費 學費 取貨 領包裹 取包裹 拿包裹 取件 寄件 店到店 交貨便 賣貨便 列印 影印 印照片 傳真 ibon famiport 儲值 加值 悠遊卡 一卡通 icash 點數卡 遊戲點數 香菸 香煙 報紙 茶葉蛋 御飯糰 關東煮 大亨堡 熱狗 烤地瓜'],

  // ── 飲料、零食、乳製品、即食 ──
  ['convenience supermarket', '飲料 飲品 礦泉水 瓶裝水 開水 氣泡水 蘇打水 汽水 可樂 雪碧 果汁 蔬果汁 運動飲料 寶礦力 舒跑 茶飲 綠茶 紅茶 烏龍茶 麥茶 無糖茶 奶茶 檸檬茶 罐裝咖啡 咖啡 拿鐵 即溶咖啡 濾掛咖啡 三合一 能量飲料 蠻牛 養樂多 優酪乳 優格 優酪 乳酸菌 布丁 果凍 豆花 零食 點心 餅乾 洋芋片 樂事 品客 蝦味先 乖乖 巧克力 糖果 軟糖 口香糖 喉糖 薄荷糖 堅果 花生 瓜子 海苔 肉乾 豬肉乾 魷魚絲 泡麵 杯麵 碗麵 科學麵 冷凍食品 微波食品 冰淇淋 雪糕 冰棒 冰塊 三明治 飯糰 便當 包子 饅頭 麥片 燕麥 穀片 早餐 罐頭 鮪魚罐頭 玉米罐頭 牛奶 鮮奶 鮮乳 保久乳 低脂奶 全脂奶 豆漿 米漿 豆奶 雞蛋 鴨蛋 皮蛋 鹹蛋 打火機 火柴'],
  ['convenience supermarket bakery', '吐司 土司 白吐司 全麥吐司'],
  ['bakery convenience supermarket', '麵包 菠蘿麵包 可頌 貝果 法國麵包 歐式麵包 餐包'],
  ['bakery', '麵包店 烘焙坊 生日蛋糕 蛋糕店 戚風 蛋塔 泡芙 甜甜圈 馬卡龍 司康 磅蛋糕'],
  ['bakery convenience', '蛋糕'],
  ['bakery supermarket', '鳳梨酥 蛋黃酥 月餅 喜餅 伴手禮 禮盒'],
  ['convenience supermarket liquor', '啤酒 台啤 生啤'],
  ['supermarket liquor convenience', '紅酒 白酒 葡萄酒 氣泡酒 香檳 威士忌 白蘭地 伏特加 琴酒 蘭姆酒 清酒 燒酎 燒酒 高粱 梅酒 調酒 水果酒'],
  ['supermarket convenience', '米酒 料理酒 料理米酒'],
  ['convenience supermarket pharmacy', '雞精 滴雞精 蜆精'],
  ['supermarket market convenience', '粽子'],

  // ── 紙類、日用消耗品 ──
  ['convenience supermarket drugstore', '衛生紙 抽取式衛生紙 捲筒衛生紙 面紙 紙巾 濕紙巾 廚房紙巾 擦手紙 衛生紙巾 口袋面紙'],
  ['convenience supermarket home', '垃圾袋 專用垃圾袋 雨傘 摺疊傘 折疊傘 自動傘 雨衣 輕便雨衣 蠟燭'],
  ['convenience pharmacy drugstore supermarket', '口罩 醫療口罩 ok繃 ok蹦 退熱貼 暖暖包 保險套 衛生套'],
  ['convenience supermarket hardware electronics', '電池 乾電池 鹼性電池 三號電池 四號電池'],
  ['electronics hardware convenience', '鈕扣電池 水銀電池'],
  ['electronics hardware supermarket', '充電電池'],

  // ── 生鮮 ──
  ['supermarket market', '蔬菜 青菜 高麗菜 大白菜 白菜 小白菜 菠菜 空心菜 地瓜葉 青江菜 芥藍 油菜 a菜 萵苣 生菜 美生菜 花椰菜 青花菜 綠花椰 白花椰 小黃瓜 大黃瓜 絲瓜 苦瓜 冬瓜 櫛瓜 番茄 牛番茄 洋蔥 蒜頭 大蒜 蒜仁 老薑 嫩薑 生薑 青蔥 蔥花 九層塔 香菜 芹菜 韭菜 辣椒 青椒 甜椒 彩椒 馬鈴薯 洋芋 紅蘿蔔 胡蘿蔔 白蘿蔔 蘿蔔 玉米 玉米筍 南瓜 茄子 秋葵 四季豆 豌豆 毛豆 豆芽 豆芽菜 香菇 金針菇 杏鮑菇 鴻喜菇 秀珍菇 木耳 竹筍 綠竹筍 筊白筍 茭白筍 蘆筍 山藥 芋頭 蓮藕 牛蒡 地瓜 豆腐 嫩豆腐 板豆腐 雞蛋豆腐 豆干 豆皮 油豆腐 百頁豆腐'],
  ['supermarket market', '豬肉 牛肉 雞肉 羊肉 鴨肉 鵝肉 絞肉 豬絞肉 牛絞肉 五花肉 梅花肉 里肌 里肌肉 小里肌 排骨 豬排 牛排 雞腿 雞腿排 雞胸 雞胸肉 雞翅 雞柳 全雞 土雞 培根 火腿 香腸 臘肉 肉鬆 貢丸 魚丸 花枝丸 火鍋料 蝦子 蝦仁 草蝦 白蝦 鮭魚 鯛魚 鱸魚 虱目魚 秋刀魚 鯖魚 鱈魚 魚片 魚排 蛤蜊 文蛤 花枝 透抽 魷魚 小卷 章魚 螃蟹 干貝 牡蠣 蚵仔 海鮮 生魚片'],
  ['fruit supermarket market', '水果 香蕉 蘋果 芭樂 橘子 柳丁 柳橙 橙子 葡萄 草莓 西瓜 哈密瓜 香瓜 洋香瓜 鳳梨 芒果 奇異果 木瓜 檸檬 百香果 火龍果 蓮霧 釋迦 荔枝 龍眼 水梨 梨子 桃子 水蜜桃 李子 櫻桃 藍莓 柿子 楊桃 椰子 酪梨 葡萄柚 文旦 柚子 棗子 蜜棗 番石榴 香吉士 小番茄 聖女番茄'],

  // ── 主食、調味料、乾貨 ──
  ['supermarket', '超市 大賣場 量販店 量販 白米 糙米 五穀米 糯米 米粉 冬粉 粉絲 麵條 拉麵 烏龍麵 義大利麵 麵線 意麵 蕎麥麵 水餃 冷凍水餃 餛飩 湯圓 年糕 火鍋 麵粉 低筋麵粉 中筋麵粉 高筋麵粉 太白粉 地瓜粉 玉米粉 酵母 泡打粉 沙拉油 食用油 椰子油 酪梨油 橄欖油 葵花油 苦茶油 麻油 香油 豬油 奶油 醬油 醬油膏 蠔油 烏醋 白醋 鹽巴 砂糖 白糖 黑糖 冰糖 二砂 味精 雞粉 高湯 高湯塊 胡椒 胡椒粉 胡椒鹽 七味粉 辣椒醬 辣油 番茄醬 美乃滋 沙茶醬 豆瓣醬 甜麵醬 味噌 咖哩 咖哩塊 調味料 醬料 沙拉醬 烤肉醬 起司 乳酪 起司片 鮮奶油 果醬 花生醬 巧克力醬 蜂蜜 楓糖 柴魚 昆布 海帶 乾香菇 紅豆 綠豆 黃豆 薏仁 燕麥片 調理包 咖啡豆 咖啡粉 奶精 方糖 茶葉 茶包'],
  ['supermarket hardware convenience', '木炭 烤肉架 烤網 竹籤 瓦斯罐 卡式瓦斯'],

  // ── 清潔、居家消耗品 ──
  ['supermarket home drugstore', '洗衣精 洗衣粉 洗衣球 洗衣膠囊 洗衣凝膠 柔軟精 衣物柔軟精 香香豆 漂白水 漂白劑 衣物漂白 洗碗精 洗碗錠 洗碗粉 菜瓜布 海綿 清潔劑 多功能清潔劑 浴廁清潔 浴室清潔 馬桶清潔 地板清潔 玻璃清潔 廚房清潔 穩潔 魔術靈 除霉 除霉劑 小蘇打 小蘇打粉 檸檬酸 去漬 去污 去漬筆 除臭 除臭劑 芳香劑 除濕盒 除濕劑 除濕包 乾燥劑 防潮 樟腦丸 防蟲片'],
  ['supermarket home', '保鮮膜 保鮮袋 保鮮盒 鋁箔紙 錫箔紙 烘焙紙 夾鏈袋 密封袋 塑膠袋 塑膠手套 拋棄式手套 橡膠手套 清潔手套 洗碗手套 免洗餐具 免洗筷 紙杯 紙盤 吸管 抹布 拖把 拖把頭 掃把 畚箕 除塵紙 除塵撢 馬桶刷 清潔刷'],
  ['supermarket hardware home', '通樂 水管疏通 疏通劑'],
  ['supermarket drugstore home convenience', '蚊香 防蚊 防蚊液 防蚊貼 驅蚊 驅蚊液 殺蟲劑 殺蟲 蟑螂藥 蟑螂屋 螞蟻藥 除蟲'],
  ['electronics home supermarket', '電蚊拍 捕蚊燈 電蚊香'],
  ['hardware home electronics supermarket', '燈泡 燈管 led燈 省電燈泡 燈具 吸頂燈'],
  ['hardware electronics home supermarket', '延長線 插座 插頭 轉接插頭'],

  // ── 洗沐、保養、化妝 ──
  ['drugstore supermarket convenience', '洗髮精 洗髮乳 洗髮露 潤髮乳 潤絲精 護髮乳 沐浴乳 沐浴露 沐浴精 肥皂 香皂 洗手乳 洗手液 乾洗手 洗面乳 洗面皂 洗顏 牙膏 牙刷 牙線 牙線棒 牙間刷 漱口水 刮鬍刀 刮鬍泡 刮鬍刀片 衛生棉 夜用衛生棉 日用衛生棉 護墊 棉條 生理用品 化妝棉 棉花棒 卸妝棉 卸妝 卸妝油 卸妝水 卸妝乳 卸妝液 生理食鹽水'],
  ['drugstore supermarket', '蘆薈 蘆薈膠 化妝水 乳液 身體乳 精華液 乳霜 面霜 眼霜 面膜 保養品 保濕 防曬 防曬乳 防曬油 防曬噴霧 隔離霜 護手霜 護唇膏 凡士林 體香劑 止汗劑 爽身粉 髮膠 髮蠟 定型液 染髮 染髮劑 梳子 髮圈 髮夾 浴帽 沐浴球 指甲剪 指甲刀 挖耳棒'],
  ['drugstore home', '精油 香薰 薰香 精油燈'],
  ['drugstore', '藥妝 藥妝店 化妝品 彩妝 粉底 粉底液 氣墊粉餅 粉餅 蜜粉 遮瑕 口紅 唇膏 唇蜜 眼影 眼線 眼線筆 眼線液 睫毛膏 眉筆 眉粉 腮紅 修容 指甲油 去光水 假睫毛 雙眼皮貼 美妝蛋 香水'],

  // ── 藥品、醫療、保健 ──
  ['pharmacy', '藥局 藥房 藥品 成藥 感冒藥 退燒藥 止痛藥 頭痛藥 普拿疼 斯斯 伏冒 克風邪 咳嗽藥 止咳 化痰 喉片 鼻炎 鼻塞 過敏藥 抗過敏 胃藥 胃乳 胃散 腸胃藥 制酸劑 整腸 表飛鳴 若元錠 正露丸 止瀉 止瀉藥 便秘 軟便 瀉藥 眼藥水 人工淚液 洗眼液 藥膏 軟膏 藥水 消炎 消炎藥 痠痛 酸痛 痠痛藥布 藥布 貼布 撒隆巴斯 肌樂 綠油精 萬金油 白花油 曼秀雷敦 優碘 碘酒 雙氧水 紗布 繃帶 彈性繃帶 透氣膠帶 人工皮 棉棒 體溫計 耳溫槍 額溫槍 血壓計 血糖機 血糖試紙 驗孕棒 驗孕 排卵試紙 酒精棉片 冰枕 痔瘡 皮膚藥 香港腳 口內炎 暈車藥 處方箋 慢性處方箋 拿藥 領藥'],
  ['pharmacy drugstore supermarket', '維他命 維生素 綜合維他命 b群 維他命c 鈣片 魚油 葉黃素 益生菌 膠原蛋白 保健食品 葡萄糖胺 薑黃 蔓越莓錠'],
  ['pharmacy drugstore supermarket convenience', '酒精 酒精噴霧 75%酒精 消毒 消毒水 次氯酸'],
  ['baby pharmacy supermarket', '奶粉 嬰兒奶粉 成長奶粉 紙尿褲 尿布 尿片 拉拉褲 嬰兒濕紙巾 奶瓶 奶嘴 安撫奶嘴 副食品 米精 麥精 嬰兒 寶寶 新生兒 固齒器 溢乳墊 防溢乳墊 哺乳'],
  ['baby', '婦嬰 婦幼 婦嬰用品 婦幼用品 嬰兒用品'],
  ['pharmacy supermarket', '成人紙尿褲 成人尿布 看護墊'],

  // ── 五金、居家修繕、園藝 ──
  ['hardware home', '五金 螺絲 螺絲釘 螺帽 螺栓 螺絲起子 起子 一字起子 十字起子 釘子 鐵釘 鐵鎚 槌子 扳手 板手 鉗子 老虎鉗 尖嘴鉗 鑽頭 電鑽 鋸子 美工刀 刀片 捲尺 工具 工具箱 工具組 工作手套 電火布 絕緣膠帶 布膠帶 封箱膠帶 泡棉膠 矽利康 ab膠 三秒膠 瞬間膠 強力膠 水龍頭 水管 蓮蓬頭 止水閥 馬桶蓋 馬桶零件 浮球 油漆 滾筒 砂紙 補土 水泥 防水膠 掛勾 掛鉤 黏鉤 無痕掛勾 鐵絲 繩子 尼龍繩 束帶 梯子 鋁梯 掛鎖 門鎖 喇叭鎖 鑰匙 打鑰匙 複製鑰匙 門把 鉸鍊 腳輪 墊片 角鐵 層板 木板 防滑條 防撞條 門擋 紗窗 滅火器 電線 開關'],
  ['hardware', '五金行'],
  ['hardware stationery convenience supermarket', '膠帶 透明膠帶 雙面膠'],
  ['stationery hardware', '紙膠帶 和紙膠帶'],
  ['florist hardware home', '培養土 盆栽土 土壤 肥料 花盆 盆器 種子 澆水器 灑水器 園藝'],

  // ── 生活百貨、家居 ──
  ['home supermarket', '收納 收納盒 收納箱 收納袋 置物架 置物盒 置物籃 整理箱 衣架 褲架 曬衣架 曬衣夾 曬衣繩 洗衣袋 洗衣籃 髒衣籃 毛巾 浴巾 擦手巾 浴室踏墊 地墊 腳踏墊 踏墊 拖鞋 室內拖鞋 浴室拖鞋 枕頭 枕頭套 棉被 涼被 毛毯 床單 床包 被套 寢具 窗簾 桌巾 碗盤 盤子 杯子 馬克杯 玻璃杯 水杯 保溫瓶 保溫杯 水壺 冷水壺 環保杯 便當盒 餐盒 餐具 筷子 湯匙 叉子 刀叉 菜刀 刀具 砧板 鍋子 平底鍋 炒鍋 湯鍋 不沾鍋 鍋鏟 湯勺 飯匙 量杯 濾網 瀝水籃 碗架 廚房用品 廚具 垃圾桶 回收桶 鏡子 時鐘 鬧鐘 相框 花瓶 抱枕 坐墊 椅墊 香氛 擴香 圍裙'],
  ['home', '生活百貨 百貨 家具 傢俱 桌子 椅子 書桌 書架 層架 鞋架 鞋櫃 衣櫃 收納櫃 床架 床墊 沙發 地毯 窗簾桿'],
  ['home supermarket sports', '卡式爐'],

  // ── 文具、書 ──
  ['stationery book home', '文具 中性筆 鋼筆 鉛筆 自動鉛筆 自動筆 筆芯 鉛筆盒 筆袋 橡皮擦 立可帶 修正帶 修正液 立可白 螢光筆 簽字筆 麥克筆 白板筆 奇異筆 色筆 彩色筆 蠟筆 水彩 粉蠟筆 畫筆 畫紙 圖畫紙 素描本 筆記本 記事本 手帳 行事曆 便條紙 資料夾 l夾 文件夾 檔案夾 卷宗 釘書機 訂書機 釘書針 訂書針 迴紋針 長尾夾 燕尾夾 口紅膠 白膠 直尺 三角板 量角器 圓規 計算機 信紙 卡片 生日卡 賀卡 包裝紙 緞帶 禮物袋 紙袋 貼紙 影印紙 a4紙 列印紙 墨水 墨水匣 碳粉 碳粉匣 標籤紙 護貝 護貝膜 書套 書皮 毛線 剪刀 春聯'],
  ['stationery convenience book', '原子筆 信封 紅包袋 紅包 便利貼 膠水'],
  ['stationery', '文具店'],
  ['stationery book', '書局'],
  ['book', '書店 書籍 小說 漫畫 繪本 字典 辭典 參考書 考古題 課本 教科書 食譜書 週刊'],
  ['convenience book', '雜誌'],

  // ── 3C、家電 ──
  ['electronics', '3c 電器行 家電 通訊行 充電線 傳輸線 數據線 lightning typec usb 充電器 充電頭 豆腐頭 快充 行動電源 耳機 藍牙耳機 airpods 喇叭 音響 滑鼠 滑鼠墊 鍵盤 隨身碟 記憶卡 sd卡 microsd 硬碟 外接硬碟 hdmi 轉接頭 轉接器 轉接線 網路線 分享器 路由器 螢幕 顯示器 保護貼 螢幕保護貼 玻璃貼 手機殼 保護殼 手機 iphone 蘋果手機 平板 ipad 電腦 筆電 筆記型電腦 印表機 相機 電視 遙控器 冰箱 洗衣機 冷氣 除濕機 空氣清淨機 電暖器 吸塵器 掃地機器人 電動牙刷 電動刮鬍刀 體重計'],
  ['electronics home supermarket', '電風扇 電扇 循環扇 吹風機 電熱水壺 快煮壺 熱水瓶 電鍋 大同電鍋 微波爐 烤箱 氣炸鍋 果汁機 調理機 咖啡機 電子鍋 烤麵包機 電磁爐'],
  ['electronics convenience', 'sim卡 網卡 預付卡 電話卡'],

  // ── 寵物 ──
  ['pet supermarket', '寵物 飼料 貓砂 豆腐砂 礦砂 松木砂 貓糧 貓飼料 貓罐 貓罐頭 主食罐 副食罐 貓零食 肉泥 貓條 貓草 狗糧 狗飼料 狗罐頭 狗零食 潔牙骨 魚飼料 鳥飼料'],
  ['pet', '寵物店 寵物用品 貓抓板 逗貓棒 貓玩具 狗玩具 寵物玩具 尿布墊 寵物尿布墊 項圈 牽繩 胸背 外出籠 寵物籠 貓砂盆 貓砂鏟 寵物床 水族 魚缸'],

  // ── 服飾、鞋、運動 ──
  ['clothing', '服飾 服飾店 衣服 上衣 t恤 襯衫 polo衫 帽t 外套 夾克 羽絨衣 羽絨外套 毛衣 針織衫 背心 褲子 長褲 短褲 牛仔褲 休閒褲 西裝褲 裙子 洋裝 睡衣 家居服 胸罩 內衣 衛生衣 發熱衣 保暖衣 圍巾 毛帽 帽子 棒球帽 領帶 皮帶 腰帶 手套'],
  ['clothing convenience supermarket', '襪子 短襪 長襪 船型襪 絲襪 褲襪 內褲 免洗內褲 免洗褲'],
  ['shoes', '鞋店 鞋子 球鞋 皮鞋 高跟鞋 涼鞋 雨鞋 靴子 短靴 布鞋 帆布鞋 休閒鞋 童鞋'],
  ['shoes sports', '運動鞋 跑鞋 慢跑鞋 籃球鞋 登山鞋'],
  ['shoes home supermarket', '鞋墊 鞋帶 鞋油'],
  ['sports', '運動用品 籃球 足球 排球 羽球 羽毛球 羽球拍 球拍 網球 網球拍 桌球 桌球拍 棒球 壘球 瑜珈墊 瑜伽墊 瑜珈 啞鈴 壺鈴 彈力帶 拉力帶 跳繩 護膝 護腕 護踝 泳衣 泳褲 泳鏡 蛙鏡 泳帽 浮板 運動服 運動褲 運動內衣 登山 登山杖 露營 帳篷 睡袋 露營燈 頭燈 營燈 天幕 高爾夫 球衣 健身'],

  // ── 花、眼鏡、玩具 ──
  ['florist', '花店 鮮花 花束 捧花 花籃 康乃馨 玫瑰 玫瑰花 向日葵 百合 百合花 滿天星 盆栽 植物 多肉 多肉植物 綠植 盆花 蘭花'],
  ['optical', '眼鏡行 眼鏡 配眼鏡 近視眼鏡 老花眼鏡 鏡片 鏡框 太陽眼鏡 墨鏡 拭鏡布 眼鏡布'],
  ['optical drugstore', '隱形眼鏡 日拋 月拋 雙週拋 角膜變色片'],
  ['drugstore optical pharmacy convenience', '隱形眼鏡藥水 隱眼藥水 保養液'],
  ['toys book', '玩具 樂高 lego 積木 拼圖 桌遊 公仔 模型 扭蛋 娃娃 玩偶 布偶 遙控車 黏土'],
  ['toys', '玩具店'],

  // ── 交通：腳踏車、機車、汽車、加油 ──
  ['bike', '腳踏車 自行車 單車 腳踏車店 打氣筒 內胎 外胎 腳踏車燈'],
  ['scooter auto', '機油 齒輪油 電瓶 輪胎 換輪胎 煞車皮'],
  ['scooter', '機車行 機車 摩托車 換機油 機車保養'],
  ['scooter supermarket', '安全帽'],
  ['scooter convenience', '機車雨衣 雨褲 一件式雨衣 兩件式雨衣'],
  ['auto', '汽車百貨 汽車 車用 雨刷 玻璃水 汽車芳香劑 車用香氛'],
  ['auto electronics', '行車紀錄器 車充 車用充電器 胎壓'],
  ['gas', '加油站 加油 汽油 柴油 95無鉛 92無鉛 98無鉛'],

  // ── 郵局、銀行 ──
  ['post', '郵局 郵票 寄信 掛號 寄掛號 掛號信 限時信 存證信函 郵寄 國際包裹'],
  ['post convenience', '寄包裹 寄東西 包裹'],
  ['post stationery book', '明信片'],
  ['atm convenience', 'atm 提款機 提款 領錢 提錢 現金'],
  ['atm', '銀行 存錢 匯款 換錢 換外幣 外幣 刷存摺 補摺 存摺'],

  // ── 只有類別名稱的品項（「去市場」「水果行」） ──
  ['market', '菜市場 傳統市場 市場 黃昏市場 早市'],
  ['fruit', '水果行']
];

// 上面的詞都對不到時才用：取品項裡「最後一個」有對應的單字。中文名詞的重點通常在最後面
// （「止咳藥」的重點是藥、「玫瑰花」是花），所以從右邊找。準確度比關鍵字差，畫面上會標成「猜的」
export const SINGLE_CHAR_RULES = {
  蛋: 'convenience supermarket', 奶: 'convenience supermarket', 米: 'supermarket', 麵: 'supermarket convenience',
  油: 'supermarket', 鹽: 'supermarket', 糖: 'supermarket', 醋: 'supermarket', 醬: 'supermarket', 粉: 'supermarket',
  肉: 'supermarket market', 魚: 'supermarket market', 蝦: 'supermarket market', 蟹: 'supermarket market',
  菜: 'supermarket market', 薑: 'supermarket market', 蔥: 'supermarket market', 蒜: 'supermarket market',
  菇: 'supermarket market', 筍: 'supermarket market', 瓜: 'supermarket market fruit',
  果: 'fruit supermarket market', 梨: 'fruit supermarket market', 莓: 'fruit supermarket market', 橘: 'fruit supermarket market',
  酒: 'convenience supermarket liquor', 茶: 'convenience supermarket', 水: 'convenience supermarket', 菸: 'convenience',
  餅: 'convenience supermarket bakery', 糕: 'bakery',
  藥: 'pharmacy', 錠: 'pharmacy', 丸: 'pharmacy', 膏: 'pharmacy drugstore', 劑: 'supermarket drugstore', 精: 'supermarket drugstore',
  乳: 'drugstore supermarket', 霜: 'drugstore',
  筆: 'stationery book', 紙: 'stationery supermarket', 書: 'book',
  花: 'florist', 鞋: 'shoes', 襪: 'clothing convenience supermarket', 衣: 'clothing', 褲: 'clothing', 裙: 'clothing', 帽: 'clothing',
  傘: 'convenience supermarket home', 燈: 'hardware home electronics', 刀: 'home hardware',
  鍋: 'home supermarket', 碗: 'home supermarket', 盤: 'home supermarket', 杯: 'home supermarket', 盒: 'home supermarket',
  架: 'home hardware', 墊: 'home', 鎖: 'hardware', 釘: 'hardware', 膠: 'hardware stationery', 線: 'electronics hardware',
  貓: 'pet supermarket', 狗: 'pet supermarket',
  繳: 'convenience', 寄: 'post convenience'
};

// 台灣常見連鎖店。兩個用途：
//   1. 品項直接寫店名（「全聯」「去好市多」）時，只找那家連鎖店（用 query 做文字搜尋、再用店名過濾）
//   2. 搜尋到的店名對得上時，補上它實際有賣的類別（寶雅除了藥妝也賣居家雜貨跟文具），
//      讓「一間買齊」的建議更準。re 比對品項文字，placeRe（沒有就用 re）比對店名；兩者都先經過
//      itemKey 正規化（小寫、拿掉空白跟標點），所以 7-ELEVEN 會變成 7eleven
// 順序有意義：「大全聯」要排在「全聯」前面，品項才會先對到量販店那一家
export const CHAINS = [
  { id: '711', label: '7-ELEVEN', query: '7-ELEVEN', cats: ['convenience'], re: /7eleven|711|統一超商|小七|seven/, placeRe: /7eleven|統一超商|^711/ },
  { id: 'familymart', label: '全家', query: '全家便利商店', cats: ['convenience'], re: /^全家|全家便利|familymart/ },
  { id: 'hilife', label: '萊爾富', query: '萊爾富', cats: ['convenience'], re: /萊爾富|hilife/ },
  { id: 'okmart', label: 'OK超商', query: 'OK超商', cats: ['convenience'], re: /ok超商|ok便利|okmart/ },
  { id: 'rtmart', label: '大全聯', query: '大全聯', cats: ['supermarket', 'home', 'electronics'], re: /大全聯|大潤發|rtmart/ },
  { id: 'pxmart', label: '全聯', query: '全聯福利中心', cats: ['supermarket'], re: /全聯/ },
  { id: 'carrefourmarket', label: '家樂福超市', query: '家樂福超市', cats: ['supermarket'], re: /家樂福超市|家樂福便利購|carrefourmarket/ },
  { id: 'carrefour', label: '家樂福', query: '家樂福', cats: ['supermarket', 'home', 'electronics'], re: /家樂福|carrefour/, placeRe: /^家樂福(?!超市|便利購)|^carrefour(?!market)/ },
  { id: 'simplemart', label: '美廉社', query: '美廉社', cats: ['supermarket'], re: /美廉社|simplemart/ },
  { id: 'costco', label: '好市多', query: '好市多', cats: ['supermarket', 'home', 'electronics'], re: /好市多|costco/ },
  { id: 'aimai', label: '愛買', query: '愛買', cats: ['supermarket', 'home', 'electronics'], re: /^愛買|愛買量販/, placeRe: /^愛買/ },
  { id: 'watsons', label: '屈臣氏', query: '屈臣氏', cats: ['drugstore'], re: /屈臣氏|watsons/ },
  { id: 'cosmed', label: '康是美', query: '康是美', cats: ['drugstore'], re: /康是美|cosmed/ },
  { id: 'poya', label: '寶雅', query: '寶雅', cats: ['drugstore', 'home', 'stationery'], re: /寶雅|poya/ },
  { id: 'matsukiyo', label: '松本清', query: '松本清', cats: ['drugstore'], re: /松本清|matsumotokiyoshi|matsukiyo/ },
  { id: 'daiso', label: '大創', query: '大創', cats: ['home', 'stationery'], re: /大創|daiso/ },
  { id: 'xiaobei', label: '小北百貨', query: '小北百貨', cats: ['home', 'hardware', 'drugstore', 'stationery'], re: /小北百貨|^小北$/, placeRe: /小北百貨/ },
  { id: 'nkd', label: '光南大批發', query: '光南大批發', cats: ['stationery', 'drugstore', 'home'], re: /光南/ },
  { id: 'muji', label: '無印良品', query: '無印良品', cats: ['home', 'clothing', 'stationery'], re: /無印良品|muji/ },
  { id: 'nitori', label: 'NITORI', query: 'NITORI 宜得利', cats: ['home'], re: /nitori|宜得利/ },
  { id: 'ikea', label: 'IKEA', query: 'IKEA', cats: ['home'], re: /ikea|宜家/ },
  { id: 'hola', label: '特力屋', query: '特力屋', cats: ['hardware', 'home'], re: /特力屋|特力和樂|^hola/ },
  { id: 'tkec', label: '燦坤', query: '燦坤', cats: ['electronics'], re: /燦坤|tkec/ },
  { id: 'elifemall', label: '全國電子', query: '全國電子', cats: ['electronics'], re: /全國電子/ },
  { id: 'sunfar', label: '順發3C', query: '順發3C', cats: ['electronics'], re: /順發/ },
  { id: 'greattree', label: '大樹藥局', query: '大樹藥局', cats: ['pharmacy', 'baby'], re: /大樹藥局/ },
  { id: 'eslite', label: '誠品', query: '誠品書店', cats: ['book', 'stationery'], re: /誠品|eslite/ },
  { id: 'kingstone', label: '金石堂', query: '金石堂', cats: ['book', 'stationery'], re: /金石堂/ },
  { id: 'jumpstone', label: '墊腳石', query: '墊腳石', cats: ['book', 'stationery'], re: /墊腳石/ },
  { id: 'nine', label: '九乘九', query: '九乘九文具', cats: ['stationery'], re: /九乘九/ },
  { id: 'decathlon', label: '迪卡儂', query: '迪卡儂', cats: ['sports'], re: /迪卡儂|decathlon/ },
  { id: 'uniqlo', label: 'UNIQLO', query: 'UNIQLO', cats: ['clothing'], re: /uniqlo|優衣庫/ },
  { id: 'baodao', label: '寶島眼鏡', query: '寶島眼鏡', cats: ['optical'], re: /寶島眼鏡/ }
];

// 還沒有購買紀錄時，「常買」那排先放這些最常見的，讓第一次用的人點一下就能加
export const STARTER_ITEMS = ['衛生紙', '牛奶', '雞蛋', '電池', '洗衣精', '垃圾袋', '牙膏', '感冒藥'];
