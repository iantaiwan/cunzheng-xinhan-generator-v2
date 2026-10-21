#!/usr/bin/env python3
"""
列印版面視覺驗證（以官方 PDF 為準，獨立於 form-layout.js 的座標）

需求：Python 3、playwright（含 Chromium）、pdfplumber、pypdf、Pillow、poppler-utils（pdftoppm）
用法：python3 tests/visual_check.py [--chrome /path/to/chrome] [--out 輸出資料夾]

檢查項目：
  1. 底圖一致：隱藏所有疊字後，列印頁面與官方 PDF 逐像素比對，差異比例需 < 0.5%
  2. 正文位置：每個正文字的中心必須落在官方 PDF 量出的對應格子內
  3. 表頭位置：姓名、地址必須落在官方「姓名」「詳細地址」標籤右側同一列
  4. 份數位置：頁數與份數數字落在官方表尾對應空白處
  5. 分頁：PDF 頁數 = 正副本份數 × 內容頁數，紙張為 A4，無多餘空白頁
  6. 字型依郵局官方範本：中文為標楷體（楷書）、英數為 Times New Roman（或字寬相容字型）
"""
import argparse
import io
import pathlib
import re
import subprocess
import sys
import tempfile
import unicodedata

import pdfplumber
import pypdf
from PIL import Image, ImageChops, ImageFilter
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OFFICIAL = ROOT / "tests" / "fixtures" / "official-10206.pdf"
CONTENT = ("一、台端於民國一百一十四年三月一日向本人借款新臺幣壹拾萬元整，約定同年六月三十日前返還。\n"
           "二、迄今仍未清償，請於收受本函後七日內返還，逾期將依法訴追。") + "測試" * 120
DATA = {
    "senderName": "王大明", "senderAddr": "台北市中正區忠孝東路一段100號5樓",
    "recvName": "李小華", "recvAddr": "台北市大安區和平東路二段200號3樓",
    "copyCount": "1", "content": CONTENT,
}
results = []
# NFKC 不處理的 CJK 部首補充區字元
RADICAL_FIX = str.maketrans({"⺠": "民", "⻑": "長", "⻄": "西", "⻝": "食"})


def check(name, ok, detail=""):
    results.append(ok)
    print(f"  {'✓' if ok else '✗'} {name}{('：' + detail) if detail else ''}")


def official_geometry():
    with pdfplumber.open(OFFICIAL) as pdf:
        page = pdf.pages[0]
        rows = sorted({round(r["top"], 1) for r in page.rects
                       if r["width"] > 15 and r["height"] < 1.2 and 240 < r["top"] < 625})
        cols = sorted({round(r["x0"], 1) for r in page.rects
                       if r["height"] > 15 and r["width"] < 1.2 and 245 < r["top"] < 300})
        labels = {}
        for w in page.extract_words():
            labels.setdefault(w["text"], []).append(w)
        return rows, cols[1:], labels   # cols[0] 是外框左緣


def render(chrome, hide_overlay):
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chrome) if chrome else p.chromium.launch()
        page = browser.new_page()
        page.goto((ROOT / "index.html").as_uri())
        for key, value in DATA.items():
            page.fill(f"#{key}", value)
        page.click("button[type=submit]")
        page.wait_for_function("Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)")
        if hide_overlay:
            # 列印時 beforeprint 會重新產生頁面，因此用 MutationObserver 持續隱藏疊字
            page.evaluate("""() => {
                const hide = () => document.querySelectorAll('.form-text,.copy-ring')
                    .forEach(e => { e.style.visibility = 'hidden'; });
                hide();
                new MutationObserver(hide).observe(document.getElementById('pages'), { childList: true, subtree: true });
            }""")
        page.emulate_media(media="print")
        pdf = page.pdf(prefer_css_page_size=True, print_background=True)
        expected = page.locator(".print-page").count()
        render.first_page_cells = page.evaluate(
            "CunzhengLogic.paginateContent(document.getElementById('content').value)[0].flat().filter(Boolean).length")
        browser.close()
    return pdf, expected


def raster(pdf_path, page_no, dpi, out_prefix):
    subprocess.run(["pdftoppm", "-f", str(page_no), "-l", str(page_no), "-r", str(dpi),
                    "-png", "-singlefile", str(pdf_path), str(out_prefix)], check=True,
                   stderr=subprocess.DEVNULL)
    return Image.open(f"{out_prefix}.png").convert("L")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chrome")
    ap.add_argument("--out")
    args = ap.parse_args()
    out = pathlib.Path(args.out or tempfile.mkdtemp())
    out.mkdir(parents=True, exist_ok=True)
    rows, cols, labels = official_geometry()

    print("[1] 底圖與官方 PDF 逐像素比對")
    blank_pdf, _ = render(args.chrome, hide_overlay=True)
    (out / "blank.pdf").write_bytes(blank_pdf)
    a = raster(OFFICIAL, 1, 300, out / "official")
    # 兩者同為 300dpi 且原點同在左上角：直接貼齊不縮放（縮放會把 1px 的高度差攤成整頁錯位）
    b_raw = raster(out / "blank.pdf", 1, 300, out / "blank")
    b = Image.new("L", a.size, 255)
    b.paste(b_raw, (0, 0))
    # 墨點比對：雙方各自容許 2px（300dpi 下約 0.17mm）位置誤差，排除反鋸齒差異
    ink_a = a.point(lambda v: 255 if v < 128 else 0)
    ink_b = b.point(lambda v: 255 if v < 128 else 0)
    missing = ImageChops.subtract(ink_a, ink_b.filter(ImageFilter.MaxFilter(5)))
    extra = ImageChops.subtract(ink_b, ink_a.filter(ImageFilter.MaxFilter(5)))
    total = ink_a.histogram()[255]
    ratio = (missing.histogram()[255] + extra.histogram()[255]) / total
    Image.merge("RGB", (missing, extra, Image.new("L", a.size, 0))).save(out / "diff.png")
    check("底圖墨點不一致比例", ratio < 0.005, f"{ratio:.3%}（紅=缺、綠=多：{out / 'diff.png'}）")

    print("[2-5] 疊字位置與分頁")
    filled_pdf, expected_pages = render(args.chrome, hide_overlay=False)
    (out / "filled.pdf").write_bytes(filled_pdf)
    reader = pypdf.PdfReader(io.BytesIO(filled_pdf))
    w_mm = round(float(reader.pages[0].mediabox.width) / 72 * 25.4)
    h_mm = round(float(reader.pages[0].mediabox.height) / 72 * 25.4)
    check("紙張為 A4", (w_mm, h_mm) == (210, 297), f"{w_mm}×{h_mm}mm")
    check("PDF 頁數 = 預覽頁數（無空白頁）", len(reader.pages) == expected_pages,
          f"PDF {len(reader.pages)} 頁、預覽 {expected_pages} 頁")

    with pdfplumber.open(out / "filled.pdf") as pdf:
        page = pdf.pages[0]
        scale = 595 / float(page.width)
        # PDF 文字抽取可能把「一、大」等字對應成康熙部首，比對前先做 NFKC 正規化
        chars = [dict(c, text=unicodedata.normalize("NFKC", c["text"]).translate(RADICAL_FIX)) for c in page.chars]

        grid_chars = [c for c in chars if rows[0] < c["top"] * scale < rows[-1] and c["x0"] * scale > cols[0]]
        misplaced = 0
        for c in grid_chars:
            cx = (c["x0"] + c["x1"]) / 2 * scale
            cy = (c["top"] + c["bottom"]) / 2 * scale
            r = next(i for i in range(10) if rows[i] <= cy < rows[i + 1])
            k = next((i for i in range(20) if cols[i] <= cx < cols[i + 1]), None)
            cell_cx = (cols[k] + cols[k + 1]) / 2 if k is not None else -99
            cell_cy = (rows[r] + rows[r + 1]) / 2
            if k is None or abs(cx - cell_cx) > 3 or abs(cy - cell_cy) > 4:
                misplaced += 1
        expected_cells = render.first_page_cells
        check("正文每字置中於官方格子", len(grid_chars) == expected_cells and misplaced == 0,
              f"{len(grid_chars)}/{expected_cells} 字、偏移 {misplaced} 字")

        first_row = "".join(c["text"] for c in sorted(
            (c for c in grid_chars if rows[0] <= (c["top"] + c["bottom"]) / 2 * scale < rows[1]),
            key=lambda c: c["x0"]))
        check("第一行內容正確", first_row == CONTENT[:20], first_row)

        def text_near(label_word, max_dx=200):
            y0, y1 = label_word["top"], label_word["bottom"]
            got = [c for c in chars if c["x0"] * scale >= label_word["x1"] - 0.5
                   and c["x0"] * scale < label_word["x1"] + max_dx
                   and (c["top"] + c["bottom"]) / 2 * scale > y0 - 6
                   and (c["top"] + c["bottom"]) / 2 * scale < y1 + 12]
            # 依字的中心線分行（中英字型的字框上緣不同，不能用 top 分組），同行再依 x 排序
            got.sort(key=lambda c: (c["top"] + c["bottom"]) / 2)
            lines, last = [], None
            for c in got:
                mid = (c["top"] + c["bottom"]) / 2
                if last is None or mid - last > 4:
                    lines.append([])
                lines[-1].append(c)
                last = mid
            return "".join(c["text"] for line in lines for c in sorted(line, key=lambda c: c["x0"]))

        name_labels = sorted(labels.get("姓名:", []) + labels.get("姓名：", []), key=lambda w: w["top"])
        addr_labels = sorted(labels["詳細地址："], key=lambda w: w["top"])
        check("寄件人姓名位置", "王大明" in text_near(name_labels[0]))
        check("寄件人地址位置", "忠孝東路" in text_near(addr_labels[0], 220))
        check("收件人姓名位置", "李小華" in text_near(name_labels[1]))
        check("收件人地址位置", "和平東路" in text_near(addr_labels[1], 220))

        def first_line_offset(label_word, max_dx=225):
            near = [c for c in chars if label_word["x1"] - 0.5 <= c["x0"] * scale < label_word["x1"] + max_dx
                    and label_word["top"] - 8 < c["top"] * scale < label_word["bottom"] + 2]
            if not near:
                return None
            label_mid = (label_word["top"] + label_word["bottom"]) / 2
            mids = [(c["top"] + c["bottom"]) / 2 * scale for c in near]
            return max(abs(m - label_mid) for m in mids)

        for label, name in [(name_labels[0], "寄件人姓名"), (addr_labels[0], "寄件人地址"),
                            (name_labels[1], "收件人姓名"), (addr_labels[1], "收件人地址")]:
            off = first_line_offset(label)
            check(f"{name}與官方標籤同一水平線", off is not None and off < 1.5,
                  "找不到文字" if off is None else f"中心偏差 {off:.2f}pt")
        addr_line = text_near(addr_labels[0], 220)
        check("一般地址單行顯示", "台北市中正區忠孝東路一段100號5樓" in addr_line, addr_line)

        def number_between(left_label, right_label, top):
            got = [c["text"] for c in chars
                   if left_label <= c["x0"] * scale and c["x1"] * scale <= right_label
                   and abs(c["top"] * scale - top) < 4 and c["text"].isdigit()]
            return "".join(got)
        check("表尾頁數", number_between(125.2, 165.2, 598.9) == str(expected_pages // 2),
              number_between(125.2, 165.2, 598.9))
        check("表尾正本份數", number_between(205.2, 245.2, 598.9) == "1")
        check("表尾副本份數", number_between(205.2, 245.2, 609.0) == "1")

    print("[6] 字型（依郵局官方範本）")
    fc = subprocess.run(["fc-list"], capture_output=True, text=True).stdout
    if re.search(r"kai|楷", fc, re.I):
        with pdfplumber.open(out / "filled.pdf") as pdf:
            page = pdf.pages[0]
            # 疊字只在格子、表頭欄位與表尾份數；以「非底圖字型」辨識：底圖文字已轉為向量路徑，不會出現在 chars
            cjk = [c for c in page.chars if ord(c["text"][0]) > 0x2E7F]
            latin = [c for c in page.chars if c["text"].isascii() and c["text"].strip()]
            bad_cjk = sorted({c["fontname"] for c in cjk if not re.search(r"kai|楷", c["fontname"], re.I)})
            bad_latin = sorted({c["fontname"] for c in latin
                                if not re.search(r"times|liberationserif|tinos", c["fontname"].replace(" ", ""), re.I)})
            check("中文填入文字為標楷體（楷書）", bool(cjk) and not bad_cjk,
                  f"{sorted({c['fontname'] for c in cjk})}" if not bad_cjk else f"非楷書：{bad_cjk}")
            check("英數填入文字為 Times New Roman（或相容字型）", bool(latin) and not bad_latin,
                  f"{sorted({c['fontname'] for c in latin})}" if not bad_latin else f"不符：{bad_latin}")
    else:
        print("  - 系統未安裝楷書字型，略過（可安裝 fonts-arphic-ukai 後再測）")

    print(f"\n結果：{sum(results)}/{len(results)} 通過；輸出檔在 {out}")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
