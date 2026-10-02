/**
 * The traditional forms the Jōyō kanji table (2010) gives in parentheses, each before the form in use today, from
 * mimneko/kanji-data at commit 0be3577 (CC0). Of its 364 traditional forms, the 62 that are compatibility ideographs
 * are left out, since NFKC turns them into the form in use already.
 */
const PAIRS = [
  '亞亜惡悪壓圧圍囲醫医爲為壹壱隱隠榮栄營営衞衛驛駅圓円鹽塩緣縁艷艶應応歐欧毆殴櫻桜',
  '奧奥橫横溫温穩穏假仮價価畫画會会繪絵壞壊懷懐槪概擴拡殼殻覺覚學学嶽岳樂楽渴渇罐缶',
  '卷巻陷陥勸勧寬寛關関歡歓觀観氣気歸帰龜亀僞偽戲戯犧犠舊旧據拠擧挙虛虚峽峡挾挟狹狭',
  '鄕郷曉暁區区驅駆勳勲薰薫徑径莖茎惠恵揭掲溪渓經経螢蛍輕軽繼継鷄鶏藝芸擊撃缺欠硏研',
  '縣県儉倹劍剣險険圈圏檢検獻献權権顯顕驗験嚴厳廣広效効恆恒黃黄鑛鉱號号國国黑黒碎砕',
  '濟済齋斎劑剤雜雑參参棧桟蠶蚕慘惨贊賛殘残絲糸齒歯兒児辭辞濕湿實実寫写釋釈壽寿收収',
  '從従澁渋獸獣縱縦肅粛處処緖緒敍叙將将稱称涉渉燒焼證証奬奨條条狀状乘乗淨浄剩剰疊畳',
  '繩縄壤壌孃嬢讓譲釀醸觸触囑嘱眞真寢寝愼慎盡尽圖図粹粋醉酔穗穂隨随髓髄樞枢數数瀨瀬',
  '聲声齊斉靜静竊窃攝摂專専淺浅戰戦踐践錢銭潛潜纖繊禪禅雙双壯壮爭争莊荘搜捜插挿巢巣',
  '曾曽瘦痩裝装總総騷騒增増藏蔵臟臓卽即屬属續続墮堕對対體体帶帯滯滞臺台瀧滝擇択澤沢',
  '擔担單単膽胆團団斷断彈弾遲遅癡痴蟲虫晝昼鑄鋳廳庁徵徴聽聴敕勅鎭鎮遞逓鐵鉄點点轉転',
  '傳伝燈灯當当黨党盜盗稻稲鬭闘德徳獨独讀読屆届貳弐惱悩腦脳霸覇拜拝廢廃賣売麥麦發発',
  '髮髪拔抜晚晩蠻蛮祕秘濱浜甁瓶拂払佛仏倂併竝並餠餅邊辺變変辨弁瓣弁辯弁步歩寶宝豐豊',
  '襃褒飜翻每毎萬万滿満麵麺默黙彌弥譯訳藥薬與与豫予餘余譽誉搖揺樣様謠謡來来賴頼亂乱',
  '覽覧龍竜兩両獵猟綠緑淚涙壘塁禮礼勵励戾戻靈霊齡齢曆暦歷歴戀恋鍊錬爐炉勞労郞郎樓楼',
  '錄録灣湾'
].join('')

const characters = [...PAIRS]

/** The form in use today of each traditional form, 髓 to 髄; a form never maps the other way, which would merge words. */
export const FORM_IN_USE: ReadonlyMap<string, string> = new Map(Array.from({ length: characters.length / 2 }, (_, index) => [characters[index * 2]!, characters[index * 2 + 1]!] as const))
