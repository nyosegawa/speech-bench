"""Character error rate of Japanese transcriptions, as written and with accepted spellings.

Usage:
    python score.py annotations.jsonl transcriptions.jsonl [--each]

annotations.jsonl is a file of this dataset. transcriptions.jsonl holds one JSON object per line, with the
"text" a model wrote and either the "clip" it heard or the "reference" sentence. The script prints how many
transcriptions it scored and both rates, the errors of all of them over the length of their references:

- as written: the transcription is compared with the reference after NFKC, lower case, the traditional
  forms of the Jōyō kanji table in their forms in use, and without spaces and the punctuation that is not
  read aloud. % ‰ ° ¥ $ € £ & stay, and . : ~ - / between two numerals;
- with accepted spellings: the same, against the closest way through the reference in which any annotated
  part may be written in the kana of its reading, hiragana and katakana alike, a bracketed stretch as one of
  its other spellings, and an optional stretch left out. The length stays that of the reference as written.

It needs Python 3.9 or later and nothing else, and counts as speech-bench does.
"""
import argparse
import hashlib
import json
import unicodedata

READ_MARKS = set('%‰°¥$€£&')
BETWEEN_NUMERALS = set('.:~〜-−/')
KANJI_NUMERALS = set('〇一二三四五六七八九十百千万億兆')
# The traditional forms of the Jōyō kanji table (2010) that NFKC does not fold, each before its form in use.
FORM_PAIRS = (
    '亞亜惡悪壓圧圍囲醫医爲為壹壱隱隠榮栄營営衞衛驛駅圓円鹽塩緣縁艷艶應応歐欧毆殴櫻桜'
    '奧奥橫横溫温穩穏假仮價価畫画會会繪絵壞壊懷懐槪概擴拡殼殻覺覚學学嶽岳樂楽渴渇罐缶'
    '卷巻陷陥勸勧寬寛關関歡歓觀観氣気歸帰龜亀僞偽戲戯犧犠舊旧據拠擧挙虛虚峽峡挾挟狹狭'
    '鄕郷曉暁區区驅駆勳勲薰薫徑径莖茎惠恵揭掲溪渓經経螢蛍輕軽繼継鷄鶏藝芸擊撃缺欠硏研'
    '縣県儉倹劍剣險険圈圏檢検獻献權権顯顕驗験嚴厳廣広效効恆恒黃黄鑛鉱號号國国黑黒碎砕'
    '濟済齋斎劑剤雜雑參参棧桟蠶蚕慘惨贊賛殘残絲糸齒歯兒児辭辞濕湿實実寫写釋釈壽寿收収'
    '從従澁渋獸獣縱縦肅粛處処緖緒敍叙將将稱称涉渉燒焼證証奬奨條条狀状乘乗淨浄剩剰疊畳'
    '繩縄壤壌孃嬢讓譲釀醸觸触囑嘱眞真寢寝愼慎盡尽圖図粹粋醉酔穗穂隨随髓髄樞枢數数瀨瀬'
    '聲声齊斉靜静竊窃攝摂專専淺浅戰戦踐践錢銭潛潜纖繊禪禅雙双壯壮爭争莊荘搜捜插挿巢巣'
    '曾曽瘦痩裝装總総騷騒增増藏蔵臟臓卽即屬属續続墮堕對対體体帶帯滯滞臺台瀧滝擇択澤沢'
    '擔担單単膽胆團団斷断彈弾遲遅癡痴蟲虫晝昼鑄鋳廳庁徵徴聽聴敕勅鎭鎮遞逓鐵鉄點点轉転'
    '傳伝燈灯當当黨党盜盗稻稲鬭闘德徳獨独讀読屆届貳弐惱悩腦脳霸覇拜拝廢廃賣売麥麦發発'
    '髮髪拔抜晚晩蠻蛮祕秘濱浜甁瓶拂払佛仏倂併竝並餠餅邊辺變変辨弁瓣弁辯弁步歩寶宝豐豊'
    '襃褒飜翻每毎萬万滿満麵麺默黙彌弥譯訳藥薬與与豫予餘余譽誉搖揺樣様謠謡來来賴頼亂乱'
    '覽覧龍竜兩両獵猟綠緑淚涙壘塁禮礼勵励戾戻靈霊齡齢曆暦歷歴戀恋鍊錬爐炉勞労郞郎樓楼'
    '錄録灣湾'
)
FORM_IN_USE = {FORM_PAIRS[index]: FORM_PAIRS[index + 1] for index in range(0, len(FORM_PAIRS), 2)}


def clusters(text):
    """The text in grapheme clusters, as far as Japanese text needs: a character with the marks that extend it."""
    out = []
    for character in text:
        code = ord(character)
        extends = (unicodedata.category(character) in ('Mn', 'Me', 'Mc') or character in '\uff9e\uff9f\u200d'
                   or 0xFE00 <= code <= 0xFE0F or 0xE0100 <= code <= 0xE01EF)
        if out and (extends or out[-1].endswith('\u200d')):
            out[-1] += character
        else:
            out.append(character)
    return out


def units(text):
    """The characters a text is compared in, each with the code-point range of the text it comes from."""
    parts = clusters(text)
    folded = [unicodedata.normalize('NFKC', part).lower() for part in parts]
    def numeral(index):
        return 0 <= index < len(folded) and len(folded[index]) == 1 and (folded[index].isdecimal() or folded[index] in KANJI_NUMERALS)
    out = []
    at = 0
    for index, part in enumerate(parts):
        start, end = at, at + len(part)
        at = end
        for character in folded[index]:
            if character.isspace() or unicodedata.category(character).startswith('Z') or character in "'’":
                continue
            if unicodedata.category(character)[0] in 'PS':
                if not (character in READ_MARKS or (character in BETWEEN_NUMERALS and numeral(index - 1) and numeral(index + 1))):
                    continue
            out.append((FORM_IN_USE.get(character, character), start, end))
    return out


def fold_kana(text):
    return ''.join(chr(ord(c) - 0x60) if 0x30A1 <= ord(c) <= 0x30F6 or ord(c) in (0x30FD, 0x30FE) else c for c in text)


def advance(row, ways, heard):
    """The distances to each prefix of what was heard, carried through the closest of the ways of one stretch."""
    best = None
    for way in ways:
        previous = list(row)
        for unit in way:
            current = [previous[0] + 1]
            for column in range(1, len(heard) + 1):
                current.append(min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (unit != heard[column - 1])))
            previous = current
        best = previous if best is None else [min(a, b) for a, b in zip(best, previous)]
    for column in range(1, len(heard) + 1):
        best[column] = min(best[column], best[column - 1] + 1)
    return best


def count_errors(sentence, segments, hypothesis):
    """The errors of a transcription and the length of its reference; with segments, against accepted spellings."""
    reference_units = units(sentence)
    heard = [fold_kana(unit) for unit, _, _ in units(hypothesis)] if segments is not None else [unit for unit, _, _ in units(hypothesis)]
    row = list(range(len(heard) + 1))
    if segments is None:
        for unit, _, _ in reference_units:
            row = advance(row, [[unit]], heard)
        return row[-1], len(reference_units)
    characters = list(sentence)
    def written(start, end):
        return [fold_kana(unit) for unit, s, e in reference_units if s >= start and e <= end]
    def in_place(spelling, before, after):
        offset, length = len(before), len(spelling)
        return [fold_kana(unit) for unit, s, _ in units(before + spelling + after) if offset <= s < offset + length]
    at = 0
    for segment in segments:
        start_row = row
        segment_start = at
        for piece in segment['pieces']:
            end = at + len(piece['text'])
            row = advance(row, [written(at, end)] + [[fold_kana(unit) for unit, _, _ in units(reading)] for reading in piece['readings']], heard)
            at = end
        if segment['bracketed']:
            before = ''.join(characters[max(0, segment_start - 1):segment_start])
            after = ''.join(characters[at:at + 1])
            ways = [in_place(spelling, before, after) for spelling in segment['spellings']] + ([[]] if segment['optional'] else [])
            other = advance(start_row, ways, heard)
            row = [min(a, b) for a, b in zip(row, other)]
    return row[-1], len(reference_units)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('annotations')
    parser.add_argument('transcriptions')
    parser.add_argument('--each', action='store_true', help='print the errors of every transcription')
    arguments = parser.parse_args()
    by_clip, by_sentence = {}, {}
    with open(arguments.annotations, encoding='utf-8') as lines:
        for line in lines:
            if line.strip():
                row = json.loads(line)
                by_sentence[row['sentence_sha256']] = row
                if row.get('clip'):
                    by_clip[row['clip']] = row
    totals = [0, 0, 0]
    with open(arguments.transcriptions, encoding='utf-8') as lines:
        for line in lines:
            if not line.strip():
                continue
            entry = json.loads(line)
            row = by_clip.get(entry['clip']) if 'clip' in entry else by_sentence.get(hashlib.sha256(entry['reference'].encode('utf-8')).hexdigest())
            if row is None:
                raise SystemExit(f'no annotation for {entry.get("clip") or entry.get("reference")}')
            plain, length = count_errors(row['sentence'], None, entry['text'])
            accepted, _ = count_errors(row['sentence'], row['segments'], entry['text'])
            totals[0] += plain
            totals[1] += accepted
            totals[2] += length
            if arguments.each:
                print(json.dumps({'clip': row.get('clip'), 'errors': plain, 'accepted_errors': accepted, 'length': length}, ensure_ascii=False))
    print(f'{totals[2]} characters; CER as written {100 * totals[0] / totals[2]:.2f}%, with accepted spellings {100 * totals[1] / totals[2]:.2f}%')


if __name__ == '__main__':
    main()
