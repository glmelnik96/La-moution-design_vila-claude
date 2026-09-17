# -*- coding: utf-8 -*-
r"""The whole deck in the approved v4 language (tools/native.py was the three-slide pilot).

Everything native.py established stays: real SB Sans Display type, placement by measured ink
box, word cascades with the long-deceleration selector, draw-on frames, backgrounds that
dissolve at master level. This file adds the element kinds the other fifteen slides need
and one structural idea: s16-s18 are ONE comp, because the user asked for them as a single
continuous build - the product table is the same seven rows in three layouts, so the row
layers persist and travel between the measured positions instead of exiting and re-entering.

ELEMENT KINDS (entry / exit)
  text     kicker hero statement block lead cardTitle rowTitle text   word cascade; drop away
           note cardBody rowBody body                              fade + rise 14; drop away
  shapes   frame    rounded-rect stroke, Trim Paths draw-on         fade
           line     1 px hairline, draw-on left to right            fade
           badge    filled rounded square + its digit               fade + rise
           pill     white pill + its label                          fade + rise
  images   panel / card   numpy-rendered gradient rect (gen_assets)  fade + rise
           icon           Figma PNG at 2x, scaled 50 %               fade + rise
           chip           block cut from the reference render        fade + rise

TIMING per slide: the headline block runs first (BEAT), then content groups start at
head_end and are spaced `st` apart, st chosen so the build ends EXIT_LEAD before the cut
(600 ms when there is room - the approved pilot pace - never below 120). Inside a group,
INTRA offsets order frame -> title -> body and a sub-stagger fans out repeated items
(chips, pills, hairlines). Exits run in reverse entry order.

Every text element carries a measure rect: the ink box Figma rendered inside that rect is
the placement target, and the same rect is written to _build/deck_verify.json so
tools/verify_deck.py can check the AE frame against it.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from native import HEAD as HEAD_V4, js  # the pilot JSX helpers are reused verbatim
import artkit
import inkmeasure

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
AE_ROOT = Path("C:/dev/gct-pres")
FPS = 25

SEMI = "SBSansDisplay-Semibold"
MED = "SBSansDisplay-Medium"
REG = "SBSansDisplay-Regular"
WHITE = [1, 1, 1]
BODY = [0.8118, 0.8118, 0.8118]            # #cfcfcf
PURPLE = [0.4549, 0.3490, 0.9765]          # #7459f9
GREY = [0.4784, 0.4784, 0.4784]            # #7a7a7a
DARK = [0.1333, 0.1333, 0.1333]            # #222222 badge digits
INK = [0.0392, 0.0235, 0.0]                # #0a0600 pill labels
LINE = [0.3490, 0.3490, 0.3490]            # #595959 hairlines
GREY4C = [0.2980, 0.2980, 0.2980]          # #4c4c4c s10 outer boxes
BORDER18 = [0.6, 0.5216, 0.9843]           # #9985fb

CASCADE = {"block": (50, 22), "statement": (50, 22), "hero": (36, 14), "kicker": (14, 6),
           "lead": (16, 6), "cardTitle": (22, 8), "rowTitle": (18, 7), "text": (22, 8)}
FADE_TEXT = ("note", "cardBody", "rowBody", "body")
HEAD_KINDS = ("kicker", "hero", "statement", "block", "lead", "note")
TRACK = {"kicker": -20, "hero": -20, "statement": -20, "block": 0, "rowTitle": -20}

# head beats: kind -> (start, stagger, duration) ms, as approved in the pilot
BEAT = {"block": (260, 0, 1750), "statement": (200, 620, 1400), "hero": (280, 300, 1150),
        "kicker": (120, 0, 640), "lead": (160, 0, 800), "note": (700, 0, 520)}
# content: kind -> (offset inside its group, duration, sub-stagger for repeated items)
INTRA = {"frame": (0, 900, 150), "line": (60, 600, 60), "panel": (0, 700, 0), "card": (0, 700, 0), "glow": (0, 900, 150),
         "icon": (400, 500, 120), "chip": (0, 500, 90), "badge": (250, 500, 0), "pill": (150, 500, 120),
         "cardTitle": (300, 700, 0), "cardBody": (440, 560, 0), "text": (300, 700, 0), "body": (440, 560, 0),
         "rowTitle": (80, 600, 0), "rowBody": (220, 500, 0), "note": (0, 520, 0), "lead": (0, 800, 0)}
ST_MAX, ST_MIN = 600, 120
EXIT_LEAD, EXIT_DUR, EXIT_STAG = 700, 360, 50
TX = 0.7
MOVE_PRE, MOVE_DUR = 250, 800          # persisting rows start moving 250 ms before a cut
PREROLL = 420                          # a slide's heads start this much before its cut: continuity across slides
ARROW = "\u2192"
MASTER = "PRESENTATION NAT"            # film 1 (renamed PRESENTATION_1 in the project); films 2-4: PRESENTATION_N


# ---------------------------------------------------------------- element constructors
def T(name, kind, text, font, size, color, rect, leading=None, justify="left", boxw=0,
      thr=None, key=None, g=None, k=0, persist=None, track=None):
    return dict(name=name, kind=kind, text=text, font=font, size=size, color=color, rect=rect,
                leading=size if leading is None else leading, justify=justify, boxw=boxw,
                thr=thr, key=key, g=g, k=k, persist=persist, track=TRACK.get(kind, 0) if track is None else track)


def FR(name, x, y, w, h, r, color=PURPLE, g=None, k=0, persist=None):
    return dict(name=name, kind="frame", x=x, y=y, w=w, h=h, r=r, color=color, g=g, k=k,
                rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7), persist=persist)


def LN(name, x, y, w, g=None, k=0):
    return dict(name=name, kind="line", x=x, y=y, w=w, color=LINE, g=g, k=k, thr=30,
                rect=(int(x) - 2, int(y) - 2, int(w) + 5, 5))


def IMG(name, kind, file, x, y, w, h, scale=100, g=None, k=0, thr=60):
    return dict(name=name, kind=kind, file=file, x=x, y=y, scale=scale, g=g, k=k, thr=thr,
                rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7))


def GLOW(name, x, y, w, h, r, g, k=0, dark=False, sw=1, scol=None, sop=100, thr=60, center=False):
    """Gradient panel/card: matte + normalized glow field + outline (tools/artkit.py)."""
    return dict(name=name, kind="glow", x=x, y=y, w=w, h=h, r=r, g=g, k=k, dark=dark, sw=sw,
                scol=PURPLE if scol is None else scol, sop=sop, thr=thr, center=center,
                rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7))


def BADGE(name, digit, x, y, g):
    return dict(name=name, kind="badge", x=x, y=y, w=70, h=70, r=20, color=PURPLE, g=g, k=0,
                rect=(x - 3, y - 3, 77, 77), text=digit, font=REG, size=36, tcolor=DARK,
                trect=(x + 9, y + 7, 52, 56), key=DARK)


def PILL(name, text, x, y, w, h, size, g, k=0):
    return dict(name=name, kind="pill", x=x, y=y, w=w, h=h, r=h / 2, color=WHITE, g=g, k=k,
                rect=(int(x) - 3, int(y) - 3, int(w) + 7, int(h) + 7), text=text, font=SEMI, size=size,
                tcolor=INK, trect=(int(x) + 13, int(y) + 6, int(w) - 26, int(h) - 12), key=INK)


# ---------------------------------------------------------------- the deck
ROWS = ["Cowork", "AI Factory", "Разработка ИИ-приложений", "Готовые сервисы",
        "Evolution Stack ML", "GPU-инфраструктура", "GPU-оборудование"]
ROW_BODY = ["Набор готовых агентов", "Сервисный слой",
            "MCP // Навыки агента // Managed OpenClaw // Managed Ouroboros // RAG",
            "Обучение  // Тюнинг моделей  // Инференс // RAG\rСоздание и работа мультиагентов, соответствующие законодательству",
            "Платформенный слой",
            "Для гибкого и экономичного управления инфрой под ИИ-приложения",
            "Масштабируемая GPU-инфраструктура под любую нагрузку.\rШирокая линейка современного «железа» под любые задачи"]
# row title tops per state (x 88/89 -> 88/89 -> 118/119) and body tops (x 959.61 -> 964)
ROW_T16 = [557.69, 629.31, 699.96, 766.06, 843.03, 911.66, 983.5]
ROW_B16 = [562.76, 634.38, 707.63, 766.97, 851.82, 917.4, 980.29]
ROW_T17 = [135.69, 209.31, 280.28, 346.38, 577.66, 644.29, 861.45]
ROW_B17 = [142, 214.38, 287.95, 353.29, 586, 657, 856.24]
ROW_T18 = [183.93, 302.05, 416.46, 529.96, 641.63, 765.71, 882.03]


# measure rects stop short of the outlines: 2 px left of the titles (the rounded corners of
# the boxes pass through x 82 at row 5), x 1810 on the right (the corner curve enters the
# body rect below 1844 otherwise), and the body height clears the box edge below row 1.
BODY_H = [52, 52, 52, 64, 52, 52, 64]
T16 = [(86, int(t) - 8, 640, 56) for t in ROW_T16]
T17 = [(86, int(t) - 8, 640, 56) for t in ROW_T17]
T18 = [(116, int(t) - 8, 640, 56) for t in ROW_T18]
B16 = [(953, int(t) - 8, 857, BODY_H[i]) for i, t in enumerate(ROW_B16)]
B17 = [(958, int(t) - 8, 852, BODY_H[i]) for i, t in enumerate(ROW_B17)]

SLIDES = {
    "s01": dict(secs=7.0, art="s01_clean", keytol=40, els=[
        T("hero", "block", "Инфраструктура\rпод ИИ зависит\rот потребности\rбизнеса", SEMI, 136, WHITE, (40, 70, 1430, 560)),
        T("lead", "lead", "Возможности интеграции ИИ в бизнес:\rпубличное, частное, гибридное модель\rдля C-level аудитории", MED, 40, WHITE, (52, 712, 830, 132)),
        T("note", "note", "Обсуждение продуктовой линейки 2026", REG, 24, BODY, (53, 994, 680, 36)),
    ]),
    "s02": dict(secs=5.5, art="s02_clean", els=[
        T("hero1", "statement", "ИИ-проекты —", SEMI, 138, PURPLE, (180, 330, 1560, 190), justify="center"),
        T("hero2", "statement", "больше чем модели", SEMI, 138, WHITE, (180, 500, 1560, 190), justify="center"),
        T("note", "note", "ИИ-инфраструктура как бизнес-решение", REG, 18, GREY, (55, 998, 400, 34)),
    ]),
    "s03": dict(secs=6.5, els=[
        T("kicker", "kicker", "ИИ-инфраструктура как бизнес-решение", SEMI, 32, WHITE, (52, 48, 790, 50), leading=35.2),
        T("hero1", "hero", "Главный вопрос: что важнее", SEMI, 90, WHITE, (46, 128, 1820, 98)),
        T("hero2", "hero", "при конкретной нагрузке?", SEMI, 90, WHITE, (46, 228, 1820, 92)),
        FR("f1", 60, 480, 885, 240, 50, g=0), FR("f2", 975, 480, 885, 240, 50, g=1),
        FR("f3", 60, 750, 885, 240, 50, g=2), FR("f4", 975, 750, 885, 240, 50, g=3),
        T("t1", "cardTitle", "Скорость", SEMI, 44, WHITE, (96, 520, 760, 62), leading=39, g=0),
        T("b1", "cardBody", "Быстро запускать ИИ-сценарии", REG, 32, BODY, (96, 586, 760, 56), g=0),
        T("t2", "cardTitle", "Контроль", SEMI, 44, WHITE, (1011, 520, 760, 62), leading=39, g=1),
        T("b2", "cardBody", "Защищать данные и доступы", REG, 32, BODY, (1011, 586, 760, 56), g=1),
        T("t3", "cardTitle", "Экономика", SEMI, 44, WHITE, (96, 790, 760, 62), leading=39, g=2),
        T("b3", "cardBody", "Не платить за простой оборудования", REG, 32, BODY, (96, 856, 760, 56), g=2),
        T("t4", "cardTitle", "Масштабирование", SEMI, 44, WHITE, (1011, 790, 760, 62), leading=39, g=3),
        T("b4", "cardBody", "Переживать пики без авралов", REG, 32, BODY, (1011, 856, 760, 56), g=3),
    ]),
    "s04": dict(secs=7.5, els=[
        T("kicker", "kicker", "Бизнес-логика выбора ИИ-инфраструктуры", SEMI, 32, WHITE, (52, 48, 1800, 50), leading=35.2),
        T("hero", "hero", "Выбор облака — это управляемый\rкомпромисс между четырьмя целями", SEMI, 90, WHITE, (46, 128, 1840, 200)),
        T("lead", "lead", "Сначала определить приоритеты бизнеса — затем выбрать модель размещения", REG, 30, BODY, (54, 338, 760, 76), boxw=705),
        FR("f1", 60, 480, 885, 240, 50, g=0), FR("f2", 975, 480, 885, 240, 50, g=1),
        FR("f3", 60, 750, 885, 240, 50, g=2), FR("f4", 975, 750, 885, 240, 50, g=3),
        BADGE("n1", "01", 833, 517, g=0), BADGE("n2", "03", 1751, 517, g=1),
        BADGE("n3", "02", 833, 794, g=2), BADGE("n4", "04", 1751, 794, g=3),
        T("t1", "cardTitle", "Скорость", SEMI, 44, WHITE, (96, 522, 720, 60), leading=39, g=0),
        T("b1", "cardBody", "Как быстро запустить новый ИИ-сервис и проверить гипотезу", REG, 32, BODY, (96, 590, 760, 80), boxw=745, g=0),
        T("t2", "cardTitle", "Экономика", SEMI, 44, WHITE, (1011, 522, 720, 60), leading=39, g=1),
        T("b2", "cardBody", "Платить за готовую мощность или инвестировать в собственную базу", REG, 32, BODY, (1011, 590, 760, 80), boxw=735, g=1),
        T("t3", "cardTitle", "Контроль", SEMI, 44, WHITE, (96, 792, 720, 60), leading=39, g=2),
        T("b3", "cardBody", "Где лежат данные, кто управляет доступом и как проходит аудит", REG, 32, BODY, (94, 866, 760, 80), boxw=721, g=2),
        T("t4", "cardTitle", "Масштабирование", SEMI, 44, WHITE, (1009, 792, 720, 60), leading=39, g=3),
        T("b4", "cardBody", "Что происходит, когда нагрузка резко растёт или меняется", REG, 32, BODY, (1009, 866, 760, 80), boxw=613, g=3),
    ]),
    "s05": dict(secs=7.0, els=[
        T("kicker", "kicker", "Публичное облако. Режим для скорости экспериментов и переменной нагрузки", SEMI, 32, WHITE, (52, 48, 1800, 50), leading=35.2),
        T("hero", "hero", "Публичное облако —\rускорение time to market ИИ-сервисов", SEMI, 90, WHITE, (46, 128, 1840, 200)),
        T("lead", "lead", "Нужен доступ к вычислениям сегодня —\rс возможностью масштабировать удачные сценарии завтра", REG, 30, BODY, (52, 336, 960, 76)),
        GLOW("panel", 60, 480, 1800, 510, 50, g=0),
        IMG("ic", "icon", "fig/s05_ic38.png", 1292, 542, 50, 44, scale=50, g=0),
        PILL("p1", "Быстрый запуск", 117.63, 656.84, 365, 49.21, 40, g=0, k=0),
        PILL("p2", "Эластичность", 717, 656.84, 322, 49.21, 40, g=0, k=1),
        PILL("p3", "Предсказуемые затраты", 1286, 656.84, 521, 49.21, 40, g=0, k=2),
        T("b1", "cardBody", "Проверяйте ИИ-гипотезы без развертывания собственной инфраструктуры", REG, 36, BODY, (114, 746, 520, 200), boxw=500, thr=185, g=1, k=0),
        T("b2", "cardBody", "Подключайте больше ресурсов на пике и возвращайтесь к базовому объёму после снижения нагрузки", REG, 36, BODY, (714, 746, 520, 200), boxw=500, thr=185, g=2, k=0),
        T("b3", "cardBody", "Переходите от крупных первоначальных инвестиций к оплате за фактическое использование", REG, 36, BODY, (1283, 746, 520, 200), boxw=500, thr=185, g=3, k=0),
    ]),
    "s06": dict(secs=7.5, els=[
        T("kicker", "kicker", "ИИ-инфраструктура как управляемый контур 2026", SEMI, 32, WHITE, (52, 48, 1800, 50), leading=35.2),
        T("hero", "hero", "Частное облако превращает контроль\rнад ИИ в управляемый бизнес-актив", SEMI, 90, WHITE, (46, 128, 1840, 200)),
        T("lead1", "lead", "Когда данные и непрерывность важнее максимальной эластичности —", REG, 30, BODY, (52, 336, 1820, 36)),
        T("lead2", "lead", "частный контур для критичных, чувствительных и регулярно используемых ИИ-нагрузок", REG, 30, WHITE, (52, 372, 1820, 36)),
        FR("f1", 60, 455.59, 580, 223.55, 40, g=0), FR("f2", 666, 455.59, 580, 223.55, 40, g=1),
        FR("f3", 1272, 455.59, 588, 223.55, 40, g=2), FR("f4", 60, 709.02, 580, 223.55, 40, g=3),
        FR("f5", 666, 709.02, 580, 223.55, 40, g=4),
        GLOW("card6", 1272, 709.02, 588, 310.98, 40, g=5),
        IMG("ic1", "icon", "fig/s06_ic36.png", 549, 491, 51, 55, scale=50, g=0),
        IMG("ic2", "icon", "fig/s06_ic37.png", 1158, 495, 54, 49, scale=50, g=1),
        T("t1", "text", "Данные не должны покидать контур", REG, 40, WHITE, (90, 484, 452, 150), boxw=444, g=0),
        T("t2", "text", "Прозрачность управления и контроля", REG, 40, WHITE, (696, 484, 452, 150), boxw=444, g=1),
        T("t3", "text", "Критичные сервисы должны быть стабильными", REG, 40, WHITE, (1302, 484, 540, 150), boxw=528, g=2),
        T("t4", "text", "Управление остаётся у компании", REG, 40, WHITE, (90, 742, 452, 150), boxw=403, g=3),
        T("t5", "text", "Экономика становится планируемой", REG, 40, WHITE, (696, 742, 452, 150), boxw=438, g=4),
        T("t6", "cardTitle", "Вывод", REG, 44, WHITE, (1302, 741, 300, 60), leading=39, thr=185, g=5),
        T("b6", "cardBody", "Меньше неопределённости в данных, доступах и непрерывности критичных ИИ-процессов. Больше управляемости для долгосрочных и чувствительных сценариев", REG, 24, BODY, (1306, 814, 540, 150), leading=28.8, boxw=528, thr=185, g=5),
    ]),
    "s07": dict(secs=6.5, st=450, els=[
        T("kicker", "kicker", "ИИ-инфраструктура как управляемый контур 2026", SEMI, 32, WHITE, (56, 52, 1800, 50), leading=35.2),
        T("hero", "hero", "Частное облако превращает контроль\rнад ИИ в управляемый бизнес-актив", SEMI, 90, WHITE, (50, 131, 1840, 200)),
        T("lead1", "lead", "Чувствительные данные остаются внутри —\rпубличные ресурсы подключаются по необходимости", REG, 30, BODY, (53, 336, 890, 76)),
        T("lead2", "lead", "Единая операционная модель помогает управлять рисками, скоростью и стоимостью ИИ-нагрузок", REG, 30, BODY, (954, 336, 900, 76), boxw=871),
        FR("f1", 59, 480, 1801, 540, 40, g=0),
        GLOW("col2", 666, 480, 588, 540, 40, g=0),
        T("t1", "text", "Частный\rконтур", SEMI, 52, WHITE, (150, 722, 420, 130), leading=46, justify="center", g=1),
        T("t2", "text", "Публичный\rконтур", SEMI, 52, WHITE, (1340, 722, 420, 130), leading=46, justify="center", g=2),
        T("t3", "text", "Единый\rИИ-сценарий,\rдва режима\rуправления", SEMI, 50, WHITE, (680, 690, 560, 220), justify="center", thr=185, g=0),
    ]),
    "s08": dict(secs=8.0, st=800, els=[
        T("kicker", "kicker", "ИИ-инфраструктура как управляемый контур 2026", SEMI, 32, WHITE, (54, 48, 1800, 50), leading=35.2),
        FR("f1", 59, 150, 1801, 870, 40, g=0),
        GLOW("col2", 666, 150, 588, 870, 40, g=0),
        IMG("ic1", "icon", "fig/s08_ic43.png", 554, 206, 45, 50, scale=50, g=0, k=0),
        IMG("ic2", "icon", "fig/s08_ic42.png", 931, 202, 57, 58, scale=50, g=0, k=1, thr=185),
        IMG("ic3", "icon", "fig/s08_ic44.png", 1321, 206, 50, 50, scale=50, g=0, k=2),
        T("t1", "text", "Частный\rконтур", SEMI, 52, WHITE, (111, 196, 420, 130), leading=46, g=0),
        T("t2", "text", "Публичный\rконтур", SEMI, 52, WHITE, (1440, 196, 370, 130), leading=46, justify="right", g=0),
        T("t3", "text", "Единый\rИИ-сценарий,\rдва режима\rуправления", SEMI, 50, WHITE, (690, 470, 540, 240), justify="center", thr=185, g=0),
        T("lt1", "cardTitle", "Чувствительные данные", SEMI, 32, PURPLE, (114, 450, 520, 44), leading=28.4, g=1),
        T("lb1", "cardBody", "Корпоративные документы, клиентские профили и критичные процессы.", REG, 32, BODY, (114, 498, 520, 110), boxw=500, g=1),
        T("lt2", "cardTitle", "Критичное ИИ-ядро", SEMI, 32, PURPLE, (114, 634, 520, 44), leading=28.4, g=2),
        T("lb2", "cardBody", "Модели и сервисы, которым нужна стабильность и предсказуемость.", REG, 32, BODY, (114, 682, 520, 110), boxw=500, g=2),
        T("lt3", "cardTitle", "Единые правила", SEMI, 32, PURPLE, (114, 818, 520, 44), leading=28.4, g=3),
        T("lb3", "cardBody", "Доступы, аудит и политики безопасности под контролем компании.", REG, 32, BODY, (114, 866, 520, 110), boxw=500, g=3),
        T("rt1", "cardTitle", "Пики нагрузки", SEMI, 32, PURPLE, (1299, 450, 512, 44), leading=28.4, justify="right", g=1),
        T("rb1", "cardBody", "Больше ресурсов без покупки инфраструктуры «на всякий случай»", REG, 32, BODY, (1299, 498, 512, 110), boxw=500, justify="right", g=1),
        T("rt2", "cardTitle", "Эксперименты", SEMI, 32, PURPLE, (1299, 634, 512, 44), leading=28.4, justify="right", g=2),
        T("rb2", "cardBody", "Быстрый запуск новых моделей,\rагентов и гипотез", REG, 32, BODY, (1299, 682, 512, 110), justify="right", g=2),
        T("rt3", "cardTitle", "Доступ к современным\rмоделям", SEMI, 32, PURPLE, (1299, 786, 512, 72), leading=28.4, justify="right", g=3),
        T("rb3", "cardBody", "Подключение внешних возможностей с сохранением корпоративных ограничений", REG, 32, BODY, (1299, 862, 512, 110), boxw=500, justify="right", g=3),
    ]),
    "s09": dict(secs=6.0, art="s09_clean", keytol=40, els=[
        T("kicker", "kicker", "Гибридная модель распределяет риски по типам нагрузки", SEMI, 32, WHITE, (52, 48, 1800, 50), leading=35.2),
        T("hero", "block", "Бизнес получает контроль\rтам, где он критичен,\rи скорость там, где она\rсоздаёт преимущество", MED, 140, WHITE, (47, 160, 1780, 530), leading=126, track=-20),
    ]),
    "s10": dict(secs=8.5, els=[
        T("kicker", "kicker", "Три модели закрывают разные бизнес-сценарии", SEMI, 32, WHITE, (56, 48, 1800, 50), leading=35.2),
        FR("f1", 60, 210, 580, 810, 50, color=GREY4C, g=0), FR("f2", 670, 210, 580, 810, 50, color=GREY4C, g=1),
        GLOW("p1", 60, 210, 580, 390, 50, g=0),
        GLOW("p2", 670, 210, 580, 390, 50, g=1),
        GLOW("p3", 1280, 210, 580, 390, 50, g=2),
        IMG("ic1", "icon", "fig/s10_ic45.png", 548, 651, 44, 45, scale=50, g=3),
        IMG("ic2", "icon", "fig/s10_ic38.png", 1161, 656, 44, 39, scale=50, g=4),
        T("t1", "cardTitle", "Частное", SEMI, 44, WHITE, (92, 244, 290, 60), leading=39, thr=185, g=0),
        T("t2", "cardTitle", "Публичное", SEMI, 44, WHITE, (698, 244, 296, 60), leading=39, thr=185, g=1),
        T("t3", "cardTitle", "Гибридное", SEMI, 44, WHITE, (1314, 244, 330, 60), leading=39, thr=185, g=2),
        PILL("pl1", "Контроль", 388, 245, 212, 49, 33, g=0), PILL("pl2", "Скорость", 1002, 245, 208, 49, 33, g=1),
        PILL("pl3", "Баланс", 1654, 245, 172, 49, 33, g=2),
        T("b1", "cardBody", "Критичные данные и постоянные нагрузки остаются в контуре компании. Максимум контроля и предсказуемости", REG, 32, BODY, (92, 364, 520, 180), boxw=503, thr=185, g=0),
        T("b2", "cardBody", "Эксперименты и пики запускаются быстро — ресурсы масштабируются вместе со спросом, без крупных стартовых вложений", REG, 32, BODY, (698, 364, 548, 180), boxw=536, thr=185, g=1),
        T("b3", "cardBody", "Чувствительное ядро — внутри, эластичные нагрузки — снаружи", REG, 32, BODY, (1314, 364, 540, 180), boxw=528, thr=185, g=2),
        T("t4", "cardTitle", "Скорость\rзапуска", SEMI, 44, WHITE, (92, 630, 440, 100), leading=39, g=3),
        T("t5", "cardTitle", "Контроль\rи затраты", SEMI, 44, WHITE, (698, 630, 440, 100), leading=39, g=4),
        T("b4", "cardBody", "Публичное — самый короткий путь от идеи к сервису. Гибридное — ускоряет новые и пиковые нагрузки. Частное — требует планирования мощностей", REG, 32, BODY, (92, 741, 500, 250), boxw=476, g=3),
        T("b5", "cardBody", "Частное облако— максимум контроля, инвестиции в актив. Публичное — оплата по мере использования, гибче при неопределенности. Гибридное — баланс CAPEX и OPEX.", REG, 32, BODY, (698, 741, 530, 250), boxw=506, g=4),
    ]),
    "s11": dict(secs=6.0, art="s11_clean", keytol=40, els=[
        T("hero", "block", "Продукты\rне исключают друг друга —\rони управляют разными\rрежимами нагрузки", SEMI, 136, WHITE, (49, 290, 1820, 560), leading=122.4, track=-20),
        T("lead", "lead", "Выбор начинается с портфеля ИИ-сценариев,\rа не с вопроса «Где все разместить?»", REG, 60, BODY, (53, 862, 1680, 136)),
    ]),
    "s12": dict(secs=7.0, els=[
        T("kicker", "kicker", "Итог для бизнеса", SEMI, 32, WHITE, (56, 48, 1000, 50), leading=35.2),
        T("hero", "hero", "Правильное облако —\rуправляемая комбинация режимов", SEMI, 90, WHITE, (51, 128, 1840, 190), leading=81),
        T("lead", "lead", "Не выбирать одно облако, а выбирать путь роста ИИ, где каждый тип нагрузки получает подходящий уровень контроля, скорости и экономической гибкости", REG, 30, BODY, (57, 330, 1680, 76), boxw=1650),
        T("note", "note", "Решение, которое нужно принять:", REG, 30, BODY, (57, 464, 700, 42)),
        FR("f1", 63.5, 540, 582, 480, 50, g=0), FR("f2", 670.5, 540, 582, 480, 50, g=1), FR("f3", 1278.5, 540, 581, 480, 50, g=2),
        IMG("ic1", "icon", "fig/s12_ic37.png", 552, 587, 48, 43, scale=50, g=0),
        IMG("ic2", "icon", "fig/s12_ic45.png", 1155, 583, 50, 51, scale=50, g=1),
        T("t1", "cardTitle", "Контроль", REG, 44, WHITE, (102, 578, 420, 60), leading=39, g=0),
        T("t2", "cardTitle", "Скорость", REG, 44, WHITE, (708, 578, 420, 60), leading=39, g=1),
        T("t3", "cardTitle", "Баланс", REG, 44, WHITE, (1314, 578, 420, 60), leading=39, g=2),
        T("b1", "cardBody", "Где данные не должны покидать контур?", REG, 32, BODY, (102, 888, 470, 90), boxw=444, g=0),
        T("b2", "cardBody", "Где нужен быстрый запуск и масштаб?", REG, 32, BODY, (708, 888, 470, 90), boxw=444, g=1),
        T("b3", "cardBody", "Где важны оба эффекта одновременно?", REG, 32, BODY, (1314, 876, 540, 100), boxw=528, g=2),
    ]),
    "s13": dict(secs=5.0, art="s13_clean", keytol=40, els=[
        T("hero", "statement", "Инфраструктура\rдля ИИ", SEMI, 148, PURPLE, (75, 330, 1770, 400), leading=162.8, justify="center"),
    ]),
    "s14": dict(secs=6.0, els=[
        T("kicker", "kicker", "Инфраструктура для ИИ", SEMI, 32, WHITE, (52, 48, 1000, 50), leading=35.2),
        T("hero", "hero", "ИИ в удобном формате", SEMI, 90, WHITE, (46, 128, 1200, 100)),
        GLOW("c1", 65, 390, 578.33, 623, 50, g=0, sw=2, center=True),
        GLOW("c2", 673.33, 390, 578.33, 623, 50, g=1, sw=2, center=True),
        GLOW("c3", 1281.67, 390, 578.33, 623, 50, g=2, sw=2, center=True),
        IMG("ic1", "icon", "fig/s14_ic43.png", 125, 450, 45, 50, scale=50, g=0, thr=185),
        IMG("ic2", "icon", "fig/s14_ic47.png", 733, 450, 63, 47, scale=50, g=1, thr=185),
        IMG("ic3", "icon", "fig/s14_ic44.png", 1342, 450, 50, 50, scale=50, g=2, thr=185),
        T("t1", "cardTitle", "Публичное\rоблако", MED, 74, WHITE, (119, 796, 470, 170), thr=185, g=0),
        T("t2", "cardTitle", "Гибридное\rоблако", MED, 74, WHITE, (727, 796, 470, 170), thr=185, g=1),
        T("t3", "cardTitle", "Частное\rоблако", MED, 74, WHITE, (1336, 796, 470, 170), thr=185, g=2),
    ]),
    "s15": dict(secs=6.5, art="s15_clean", keytol=40, els=[
        T("hero", "block", "Развиваем единую\rинфраструктуру в собственном\rЦОД, публичном или гибридном\rоблаке без изменения\rархитектуры приложения", SEMI, 116, WHITE, (58, 412, 1840, 610), track=-20),
    ]),
    # ---- the continuous build: three states of one comp, rows persist and travel
    "s16": dict(secs=5.0, els=[
        T("kicker", "kicker", "Инфраструктура для ИИ", SEMI, 32, WHITE, (52, 48, 1000, 50), leading=35.2,
          persist={"s17": (52, 48, 1000, 50), "s18": (52, 48, 1000, 50)}),
        T("hero", "hero", "Развиваем единую инфраструктуру\rв собственном ЦОД, публичном или\rгибридном облаке без изменения\rархитектуры приложения", SEMI, 90, WHITE, (46, 128, 1850, 380)),
        FR("f1", 60, 540, 1800, 72, 36.5, g=0), FR("f2", 60, 612, 1800, 215, 50.5, g=1), FR("f3", 60, 827, 1800, 215, 50.5, g=5),
        LN("h1", 89, 683.68, 1741, g=1, k=1), LN("h2", 89, 755.52, 1741, g=1, k=2),
        LN("h3", 89, 899.2, 1741, g=5, k=1), LN("h4", 89, 971.04, 1741, g=5, k=2),
    ] + [T("r%d" % (i + 1), "rowTitle", ROWS[i], SEMI, 36, WHITE, T16[i], leading=39.6, g=[0, 2, 3, 4, 6, 7, 8][i],
           persist={"s17": T17[i], "s18": T18[i]}) for i in range(7)]
      + [T("rb%d" % (i + 1), "rowBody", ROW_BODY[i], REG, 24, BODY, B16[i], leading=26.4, g=[0, 2, 3, 4, 6, 7, 8][i],
           persist={"s17": B17[i]}) for i in range(7)]),
    "s17": dict(secs=5.5, els=[
        FR("f1", 60, 120, 1800, 72, 36, g=0, k=0), FR("f2", 60, 192, 1800, 362, 50, g=0, k=1), FR("f3", 60, 554, 1800, 475, 50, g=0, k=2),
        LN("h1", 88, 264.03, 1741, g=0, k=3), LN("h2", 88, 336.03, 1741, g=0, k=4),
        LN("h3", 89, 632.03, 1741, g=0, k=5), LN("h4", 89, 829.03, 1741, g=0, k=6),
    ] + [IMG("m%d" % (i + 1), "chip", "gen/s17_chip_m%d.png" % (i + 1), 0, 0, 0, 0, g=1, k=i) for i in range(6)]
      + [IMG("c%d" % (i + 1), "chip", "gen/s17_chip_c%d.png" % (i + 1), 0, 0, 0, 0, g=2, k=i) for i in range(3)]
      + [IMG("g%d" % (i + 1), "chip", "gen/s17_chip_g%d.png" % (i + 1), 0, 0, 0, 0, g=3, k=i) for i in range(5)]),
    "s18": dict(secs=5.5, els=[
        FR("pf", 59, 120, 1801, 900, 40, g=0),
    ] + [LN("hl%d" % (i + 1), 119, y, 811, g=0, k=i + 1) for i, y in enumerate([164, 280.58, 397.16, 513.75, 628.71, 745.29, 861.88])]
      + [GLOW("c1", 990, 120, 870, 342, 50, g=1, dark=True, scol=BORDER18, sop=25, thr=40),
         GLOW("c2", 990, 400, 870, 340, 50, g=2, dark=True, scol=BORDER18, sop=25, thr=40),
         GLOW("c3", 990, 677.78, 870, 342, 50, g=3, dark=True, scol=BORDER18, sop=25, thr=40),
         T("t1", "cardTitle", "Любая комбинация сценариев развертывания", MED, 52, WHITE, (1044, 172, 780, 130), boxw=750, thr=185, g=1),
         T("t2", "cardTitle", "Быстрая поставка\rмощностей", MED, 52, WHITE, (1044, 452, 780, 130), thr=185, g=2),
         T("t3", "cardTitle", "Прикладная ИИ экспертиза по инфраструктурной и платформенной части", MED, 52, WHITE, (1044, 730, 780, 180), boxw=750, thr=185, g=3)]),
}


def chip_geometry():
    """s17 chips take their rects from the cut metadata written by gen_assets."""
    meta = json.load(open(ROOT / "_build" / "gen_assets.json", encoding="utf-8"))["s17_chips"]
    for el in SLIDES["s17"]["els"]:
        if el["kind"] == "chip":
            m = meta[el["name"]]
            el.update(x=m["x"], y=m["y"], rect=(m["x"] - 2, m["y"] - 2, m["w"] + 4, m["h"] + 4))


chip_geometry()


# ---------------------------------------------------------------- measurement
def key_mask(sub, key, tol=40):
    """Pixels within tol of the key colour - or of any colour when key is a list of colours."""
    cols = key if isinstance(key[0], (list, tuple)) else [key]
    m = np.zeros(sub.shape[:2], bool)
    for c in cols:
        m |= np.abs(sub - np.array([int(round(v * 255)) for v in c])).max(axis=2) < tol
    return m


def ink(sid, rect, rgb=None, thr=None, key=None, core=None, size=None):
    """Ink bbox inside `rect` of Figma's render: luminance on black, colour key on artwork
    or when `key` is given (dark digits on a purple badge, dark labels on a white pill)."""
    a = np.asarray(Image.open(ASSETS / f"{sid}_full.png").convert("RGB")).astype(int)
    x, y, w, h = [int(v) for v in rect]
    sub = a[y:y + h, x:x + w]
    if key is not None:
        m = key_mask(sub, key)
    elif SLIDES[sid].get("art") and rgb is not None:
        col = np.array([int(round(c * 255)) for c in rgb])
        grey = abs(col[0] - col[1]) < 8 and abs(col[1] - col[2]) < 8 and col[0] < 170
        tol = 28 if grey else SLIDES[sid].get("keytol", 70)
        m = np.abs(sub - col).max(axis=2) < tol
    else:
        m = sub.max(axis=2) > (thr or 100)
    if core is not None:                       # only this text's own glyph components (tools/inkmeasure.py)
        cx, cy, cw, ch = [int(v) for v in core]
        m = inkmeasure.own_mask(m, (cx - x, cy - y, cx - x + cw, cy - y + ch), size)
    if not m.any():
        raise SystemExit(f"{sid}: no ink in {rect}")
    ys, xs = np.where(m)
    return x + int(xs.min()), y + int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


def vmode(sid, el):
    """How the verifier isolates this element in the AE frame (same rule as ink())."""
    if el.get("key"):
        return dict(mode="key", key=el["key"])
    if SLIDES[sid].get("art") and "color" in el:
        return dict(mode="art", rgb=el["color"], keytol=SLIDES[sid].get("keytol", 70))
    return dict(mode="lum", thr=el.get("thr") or (100 if "text" in el else 60))


# ---------------------------------------------------------------- line breaks and icons, fitted to the render
FONT_FILES = {SEMI: "C:/Windows/Fonts/SBSansDisplay-SemiBold.otf", MED: "C:/Windows/Fonts/SBSansDisplay-Medium.otf",
              REG: "C:/Windows/Fonts/SBSansDisplay-Regular.otf", "SBSansDisplay-Bold": "C:/Windows/Fonts/SBSansDisplay-Bold.otf"}
PIL_BIAS = 0.988          # PIL ink widths of SB Sans Display run ~1.2 % wider than Figma's render
_fonts = {}
FIT_LOG = []


def _font(face, size):
    k = (face, size)
    if k not in _fonts:
        from PIL import ImageFont
        _fonts[k] = ImageFont.truetype(FONT_FILES[face], size)
    return _fonts[k]


def _inkw(text, face, size, track):
    f = _font(face, size)
    l, t, r, b = f.getbbox(text)
    return ((r - l) + track / 1000 * size * max(0, len(text) - 1)) * PIL_BIAS


def _greedy(words, face, size, track, width):
    lines, cur = [], ""
    for wd in words:
        if wd == "\r":
            if cur:
                lines.append(cur)
            cur = ""
            continue
        cand = wd if not cur else cur + " " + wd
        if cur and _inkw(cand, face, size, track) > width:
            lines.append(cur); cur = wd
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines


def ref_lines(sid, el):
    """Per-line ink widths in Figma's render: bands of inked rows, keeping only bands at
    least an x-height tall (diacritics, descenders and dots form shorter bands)."""
    a = np.asarray(Image.open(ASSETS / f"{sid}_full.png").convert("RGB")).astype(int)
    x, y, w, h = [int(v) for v in el["rect"]]
    sub = a[y:y + h, x:x + w]
    if el.get("key") is not None:
        m = key_mask(sub, el["key"])
    elif SLIDES[sid].get("art"):
        m = np.abs(sub - np.array([int(round(c * 255)) for c in el["color"]])).max(axis=2) < SLIDES[sid].get("keytol", 70)
    else:
        m = sub.max(axis=2) > (el.get("thr") or 100)
    if el.get("core"):
        cx, cy, cw, ch = [int(v) for v in el["core"]]
        m = inkmeasure.own_mask(m, (cx - x, cy - y, cx - x + cw, cy - y + ch), el["size"])
    merged = inkmeasure.bands_of(m, max(3, int(0.35 * el["size"])))
    out = []
    for t, bt in merged:
        cols = np.where(m[t:bt + 1].any(axis=0))[0]
        out.append(int(cols.max() - cols.min() + 1))
    return out


def fit_lines(sid, el):
    """Reproduce Figma's line breaks for a wrapped paragraph.

    The design context's box width does not reproduce the breaks (boxes are wider than the
    text they hold, and some breaks are manual), so the render is the reference: measure
    each line's ink width, then choose the break positions whose lines, set in the real font
    metrics, match those widths best. Breaks replace spaces of the original string 1:1 so
    character indices (colour ranges) stay valid; manual breaks are kept as they are."""
    text = el["text"]
    if not el.get("boxw"):
        return text
    face, size, track = el["font"], el["size"], el["track"]
    refs = ref_lines(sid, el)
    n = len(refs)
    forced = [i for i, ch in enumerate(text) if ch == "\r"]
    spaces = [i for i, ch in enumerate(text) if ch == " "]
    # Figma also breaks after a hyphen inside a word: a break inserted after it
    hyphens = [i for i, ch in enumerate(text) if ch == "-" and i + 1 < len(text) and text[i + 1] not in " \r"]
    cands = sorted(spaces + hyphens)
    extra = n - 1 - len(forced)
    el["_inserts"] = []
    if extra <= 0 or extra > len(cands):
        if extra != 0:
            FIT_LOG.append("%s/%s: %d ref lines, %d manual breaks, %d candidates - left as is   <-- CHECK"
                           % (sid, el["name"], n, len(forced), len(cands)))
        return text

    def lines_for(cuts):
        pos = sorted(forced + list(cuts))
        out, start = [], 0
        for c in pos:
            if text[c] == "-":
                out.append(text[start:c + 1]); start = c + 1
            else:
                out.append(text[start:c]); start = c + 1
        out.append(text[start:])
        return [l.strip(" ") for l in out]                # spaces at a wrap render nowhere

    from itertools import combinations
    best = None
    for cuts in combinations(cands, extra):
        ls = lines_for(cuts)
        cost = sum(abs(_inkw(ls[k], face, size, track) - refs[k]) for k in range(n))
        if best is None or cost < best[0]:
            best = (cost, cuts)
    cuts = best[1]
    ls = lines_for(cuts)
    widths = [int(_inkw(l, face, size, track)) for l in ls]
    worst = max(abs(widths[k] - refs[k]) for k in range(n))
    FIT_LOG.append("%s/%s: %d lines, widths %s vs ref %s%s" % (sid, el["name"], n, widths, refs, "   <-- CHECK" if worst > 12 else ""))
    inserts, deleted, breaks = [], set(), set()
    for c in cuts:
        if text[c] == "-":
            inserts.append(c)                       # a break AFTER the hyphen: one char inserted
            continue
        breaks.add(c)
        j = c - 1                                   # the rest of a run of spaces vanishes with the wrap
        while j >= 0 and text[j] == " ":
            deleted.add(j); j -= 1
        j = c + 1
        while j < len(text) and text[j] == " ":
            deleted.add(j); j += 1
    res = []
    for i, ch in enumerate(text):
        if i in deleted:
            continue
        res.append("\r" if i in breaks else ch)
        if i in inserts:
            res.append("\r")
    el["_inserts"] = sorted(inserts)
    el["_deleted"] = sorted(deleted)
    return "".join(res)


def map_idx(el, i):
    """Original character index -> index in the fitted string (hyphen breaks insert, wrap spaces vanish)."""
    return i + sum(1 for j in el.get("_inserts", []) if j < i) - sum(1 for j in el.get("_deleted", []) if j < i)


def ae_idx(fitted, p):
    """Index for a text animator range selector: AE counts rendered characters only, a line break is not one."""
    return p - fitted[:p].count("\r")


def icon_fit(sid, el):
    """Place a 2x icon export so its rendered ink box lands on Figma's ink box.

    The exports are the vector's own bounds, not the node box, and after downscaling their
    soft edge shifts the luminance box by a few px; measure the downscaled PNG the same way
    the verifier measures the frame and solve for position (and scale when the size is off)."""
    im = Image.open(ASSETS / el["file"]).convert("RGBA")
    thr = el.get("thr", 60)
    ex, ey, ew, eh = ink(sid, el["rect"], thr=thr, key=el.get("key"))

    def box(scale):
        sm = im.resize((max(1, round(im.width * scale / 100)), max(1, round(im.height * scale / 100))), Image.LANCZOS)
        a = np.asarray(sm).astype(int)
        lum = (a[:, :, :3] * a[:, :, 3:4] // 255).max(axis=2) > thr
        if not lum.any():
            lum = a[:, :, 3] > 128                          # a dark bitmap: its alpha is the shape
        ys, xs = np.where(lum)
        return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)

    sc = 50.0
    bx, by, bw, bh = box(sc)
    if abs(bw - ew) > 1 or abs(bh - eh) > 1:
        sc = 50.0 * ((ew / bw) + (eh / bh)) / 2
        bx, by, bw, bh = box(sc)
    return ex - bx, ey - by, sc


# ---------------------------------------------------------------- JSX additions
HEAD_EXTRA = r"""
function txtBox(c, name, str, font, size, color, leading, justify, tracking) {
  var L = c.layers.addText(str);
  L.name = name;
  var st = L.property("ADBE Text Properties").property("ADBE Text Document");
  var d = st.value; d.text = str; st.setValue(d);
  var live = st.value;
  live.fontSize = size;
  live.font = font;
  live.fillColor = color;
  live.applyFill = true;
  live.applyStroke = false;
  live.tracking = tracking;
  live.autoLeading = false;
  live.leading = leading;
  live.justification = justEnum(justify);
  st.setValue(live);
  if (String(st.value.font) !== font) throw new Error("font not applied: " + font);
  return L;
}
// NOT a nested ternary: ExtendScript parses a ? X : b ? Y : Z left-associatively (quirk #95)
function justEnum(justify) {
  if (justify === "center") return ParagraphJustification.CENTER_JUSTIFY;
  if (justify === "right") return ParagraphJustification.RIGHT_JUSTIFY;
  return ParagraphJustification.LEFT_JUSTIFY;
}
function alignCenter(L, cx, cy) {
  var r = L.sourceRectAtTime(0, false);
  pos(L).setValue([cx - r.left - r.width / 2, cy - r.top - r.height / 2]);
  return L;
}
function png(c, name, path, x, y, sc) {
  var l = c.layers.add(foot(path));
  l.name = name;
  P(l).property("ADBE Anchor Point").setValue([0, 0]);
  pos(l).setValue([x, y]);
  if (sc !== 100) scl(l).setValue([sc, sc]);
  return l;
}
// stroke sits inside the box like Figma's SVG (path inset by half the width): crisp, no halo
function rrect(c, name, x, y, w, h, r, fill, stroke, sw, center) {
  var S = c.layers.addShape();
  S.name = name;
  P(S).property("ADBE Anchor Point").setValue([0, 0]);
  pos(S).setValue([0, 0]);
  var g = S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  g.name = "frame";
  var ins = (stroke && !center) ? sw / 2 : 0;          // Figma strokes: inside by default, CENTER on the s14 cards
  var rc = g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
  rc.property("ADBE Vector Rect Size").setValue([w - 2 * ins, h - 2 * ins]);
  rc.property("ADBE Vector Rect Position").setValue([x + w / 2, y + h / 2]);
  try { rc.property("ADBE Vector Rect Roundness").setValue(Math.max(0, r - ins)); } catch (e0) {}
  var gg = groupNamed(S, "frame");
  if (fill) {
    var fl = gg.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
    fl.property("ADBE Vector Fill Color").setValue(fill);
    gg = groupNamed(S, "frame");
  }
  if (stroke) {
    var sk = gg.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
    sk.property("ADBE Vector Stroke Color").setValue(stroke);
    sk.property("ADBE Vector Stroke Width").setValue(sw);
  }
  return S;
}
function hline(c, name, x, y, w, color) { return line2(c, name, x, y, x + w, y, color, 1); }
// a line icon rebuilt from its SVG paths (node-local coordinates), stroked, ready to draw on
function svgShape(c, name, paths, x, y, color, sw) {
  var S = c.layers.addShape();
  S.name = name;
  P(S).property("ADBE Anchor Point").setValue([0, 0]);
  pos(S).setValue([x, y]);
  var g = S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  g.name = "frame";
  for (var i = 0; i < paths.length; i++) {
    var gg = groupNamed(S, "frame");
    var pth = gg.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
    var sh = new Shape();
    sh.vertices = paths[i].v; sh.inTangents = paths[i].i; sh.outTangents = paths[i].o; sh.closed = !!paths[i].c;
    pth.property("ADBE Vector Shape").setValue(sh);
  }
  var g2 = groupNamed(S, "frame");
  var sk = g2.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
  sk.property("ADBE Vector Stroke Color").setValue(color);
  sk.property("ADBE Vector Stroke Width").setValue(sw);
  try { sk.property("ADBE Vector Stroke Line Cap").setValue(2); sk.property("ADBE Vector Stroke Line Join").setValue(2); } catch (e0) {}
  return S;
}
// the settle, reversed: a soft scale-down with a blur as the object leaves
function settleOut(L, ms0, dur, s1, bl) {
  var s = scl(L).valueAtTime(f(ms0), false);          // the rest scale at the exit, not the pre-entrance value at t=0
  tw(scl(L), ms0, ms0 + dur, s, [s[0] * s1, s[1] * s1], "out");
  if (bl) {
    var fx = L.property("ADBE Effect Parade").property("ADBE Gaussian Blur 2");
    if (!fx) { fx = L.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2"); try { fx.property("ADBE Gaussian Blur 2-0003").setValue(true); } catch (e0) {} }
    tw(fx.property("ADBE Gaussian Blur 2-0001"), ms0, ms0 + dur, 0, bl, "out");
  }
}
// a flat arrow as one open path (shaft, tip, upper barb, tip, lower barb) so Trim Paths shoots it out
function arrow(c, name, x1, y, x2, hx, hy, sw, color) {
  var S = c.layers.addShape();
  S.name = name;
  P(S).property("ADBE Anchor Point").setValue([0, 0]);
  pos(S).setValue([0, 0]);
  var g = S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  g.name = "frame";
  var pth = g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
  var sh = new Shape();
  sh.vertices = [[x1, y], [x2, y], [x2 - hx, y - hy], [x2, y], [x2 - hx, y + hy]];
  sh.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
  sh.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
  sh.closed = false;
  pth.property("ADBE Vector Shape").setValue(sh);
  var gg = groupNamed(S, "frame");
  var sk = gg.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
  sk.property("ADBE Vector Stroke Color").setValue(color);
  sk.property("ADBE Vector Stroke Width").setValue(sw);
  try { sk.property("ADBE Vector Stroke Line Cap").setValue(2); sk.property("ADBE Vector Stroke Line Join").setValue(2); } catch (e0) {}
  return S;
}
function line2(c, name, x1, y1, x2, y2, color, sw) {
  var S = c.layers.addShape();
  S.name = name;
  P(S).property("ADBE Anchor Point").setValue([0, 0]);
  pos(S).setValue([0, 0]);
  var g = S.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
  g.name = "frame";
  var pth = g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
  var sh = new Shape();
  sh.vertices = [[x1, y1], [x2, y2]];
  sh.inTangents = [[0, 0], [0, 0]];
  sh.outTangents = [[0, 0], [0, 0]];
  sh.closed = false;
  pth.property("ADBE Vector Shape").setValue(sh);
  var gg = groupNamed(S, "frame");
  var sk = gg.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
  sk.property("ADBE Vector Stroke Color").setValue(color);
  sk.property("ADBE Vector Stroke Width").setValue(sw);
  return S;
}
// one character in another font (Figma's fallback arrow is Inter's long thin one; AE 24+ character ranges)
function trackRange(L, s, e, v) {
  try {
    var st = L.property("ADBE Text Properties").property("ADBE Text Document");
    var d = st.value;
    var cr = d.characterRange(s, e);
    cr.tracking = v;
    st.setValue(d);
  } catch (e0) {}
}
function fontRange(L, s, e, font) {
  var st = L.property("ADBE Text Properties").property("ADBE Text Document");
  var d = st.value;
  var cr = d.characterRange(s, e);
  cr.font = font;
  st.setValue(d);
}
// plate + bitmap precomposed into one layer of the plate's size (a QR on its square, a screenshot on its card)
function unitLayer(c, name, x, y, w, h, r, fill, stroke, sw, center, bmpPath, bx, by, bsc, dur) {
  var q = app.project.items.addComp(name, Math.ceil(w) + 2, Math.ceil(h) + 2, 1, c.duration, c.frameRate);   // span the whole slide comp
  rrect(q, name + "_plate", 1, 1, w, h, r, fill, stroke, sw, center);
  png(q, name + "_bmp", bmpPath, bx - x + 1, by - y + 1, bsc);
  var L = c.layers.add(q);
  L.name = name;
  P(L).property("ADBE Anchor Point").setValue([0, 0]);
  pos(L).setValue([x - 1, y - 1]);
  return L;
}
// scale about the layer's own centre: anchor to the source rect centre, keeping the layer in place
function centerSelf(L) {
  var r = L.sourceRectAtTime(0, false);
  var a = P(L).property("ADBE Anchor Point").value, p = pos(L).value, s = scl(L).value;
  var nx = r.left + r.width / 2, ny = r.top + r.height / 2;
  pos(L).setValue([p[0] + (nx - a[0]) * s[0] / 100, p[1] + (ny - a[1]) * s[1] / 100]);
  P(L).property("ADBE Anchor Point").setValue([nx, ny]);
}
// the settle: a soft scale from s0 to rest with a blur clearing as it lands (no overshoot, long tail)
function settleIn(L, ms0, dur, s0, bl) {
  var s = scl(L).value;
  tw(scl(L), ms0, ms0 + dur, [s[0] * s0, s[1] * s0], s, "in");
  tw(opa(L), ms0, ms0 + dur * 0.55, 0, 100, "in");
  if (bl) {
    var fx = L.property("ADBE Effect Parade").addProperty("ADBE Gaussian Blur 2");
    try { fx.property("ADBE Gaussian Blur 2-0003").setValue(true); } catch (e0) {}
    tw(fx.property("ADBE Gaussian Blur 2-0001"), ms0, ms0 + dur * 0.8, bl, 0, "in");
  }
}
// a second colour inside one text layer: Fill Color animator over a character index range
function colorRange(L, s, e, rgb) {
  var an = L.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
  an.name = "color " + s + "-" + e;
  var sels = an.property("ADBE Text Selectors");
  if (sels.numProperties === 0) sels.addProperty("ADBE Text Selector");
  var sel = sels.property(1);
  var adv = sel.property("ADBE Text Range Advanced");
  adv.property("ADBE Text Range Type2").setValue(1);       // characters
  adv.property("ADBE Text Range Units").setValue(2);       // index
  sel.property("ADBE Text Index Start").setValue(s);
  sel.property("ADBE Text Index End").setValue(e);
  an.property("ADBE Text Animator Properties").addProperty("ADBE Text Fill Color").setValue(rgb);
  return an;
}
// right-aligned text: the same cascade run from the right - Ramp Down sweeping left, so the
// words nearest the right edge land first and a line never hangs by its leftmost word
function cascadeR(L, ms0, dur, rise, blur) {
  var an = L.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
  an.name = "cascade";
  var sels = an.property("ADBE Text Selectors");
  if (sels.numProperties === 0) sels.addProperty("ADBE Text Selector");
  var sel = sels.property(1);
  var adv = sel.property("ADBE Text Range Advanced");
  adv.property("ADBE Text Range Type2").setValue(3);
  adv.property("ADBE Text Range Shape").setValue(3);
  adv.property("ADBE Text Levels Max Ease").setValue(20);
  adv.property("ADBE Text Levels Min Ease").setValue(100);
  sel.property("ADBE Text Percent Start").setValue(100 - RAMP);
  sel.property("ADBE Text Percent End").setValue(100);
  var props = an.property("ADBE Text Animator Properties");
  if (rise) props.addProperty("ADBE Text Position 3D").setValue([0, rise, 0]);
  props.addProperty("ADBE Text Opacity").setValue(0);
  if (blur) props.addProperty("ADBE Text Blur").setValue([blur, blur]);
  var off = sel.property("ADBE Text Percent Offset");
  off.setValueAtTime(f(ms0), RAMP);
  off.setValueAtTime(f(ms0 + dur), -100);
  ease(off, 40, 60);
  return L;
}
// elements that live across a cut: travel between measured rest positions
function travel(L, ms0, ms1, p0, p1) {
  pos(L).setValueAtTime(f(ms0), p0);
  pos(L).setValueAtTime(f(ms1), p1);
}
// same text, different alignment on the next slide: a hold key on Source Text at the cut
function retext(L, ms, justify) {
  var st = L.property("ADBE Text Properties").property("ADBE Text Document");
  if (st.numKeys === 0) st.setValueAtTime(0, st.value);
  var d = st.value;
  d.justification = justEnum(justify);
  st.setValueAtTime(f(ms), d);
}
// a frame that continues into the next slide grows into its new box instead of redrawing
function morph(S, ms0, ms1, a, b, ins) {
  var rc = groupNamed(S, "frame").property("ADBE Vectors Group").property("ADBE Vector Shape - Rect");
  var sz = rc.property("ADBE Vector Rect Size"), ps = rc.property("ADBE Vector Rect Position");
  sz.setValueAtTime(f(ms0), [a[2] - 2 * ins, a[3] - 2 * ins]);
  sz.setValueAtTime(f(ms1), [b[2] - 2 * ins, b[3] - 2 * ins]);
  ps.setValueAtTime(f(ms0), [a[0] + a[2] / 2, a[1] + a[3] / 2]);
  ps.setValueAtTime(f(ms1), [b[0] + b[2] / 2, b[1] + b[3] / 2]);
  try {
    var rd = rc.property("ADBE Vector Rect Roundness");
    rd.setValueAtTime(f(ms0), Math.max(0, a[4] - ins));
    rd.setValueAtTime(f(ms1), Math.max(0, b[4] - ins));
    ease(rd, 60, 60);
  } catch (e) {}
  ease(sz, 60, 60); ease(ps, 60, 60);
}
"""


def c3(v):
    return "[%.4f, %.4f, %.4f]" % tuple(v)


# ---------------------------------------------------------------- segments and persistence
# Consecutive slides that share elements are ONE comp: a text that is the same on the next
# slide stays on screen and travels to its new place (re-justified at the cut when the
# alignment changes), a frame with the same name grows into its new box, a hairline slides.
SEGMENTS = [["s01"], ["s02"], ["s03"], ["s04"], ["s05"], ["s06", "s07", "s08"], ["s09"], ["s10"],
            ["s11"], ["s12"], ["s13"], ["s14"], ["s15"], ["s16", "s17", "s18"]]


def seg_name(seg):
    return "%s NAT" % seg[0].upper() if len(seg) == 1 else "%s-%s NAT" % (seg[0].upper(), seg[-1][1:])


def sig(el):
    return (el["text"], el["font"], el["size"], tuple(el["color"]), el["leading"], el["track"])


def match(cur, sid2, absorbed):
    """The element of state sid2 that `cur` continues as, or None."""
    if cur.get("persist"):
        if sid2 in cur["persist"]:
            return dict(cur, rect=cur["persist"][sid2], _synth=True)
        return None
    kind = cur["kind"]
    for el2 in SLIDES[sid2]["els"]:
        if (sid2, el2["name"]) in absorbed:
            continue
        if "text" in cur and "text" in el2 and kind not in ("badge", "pill") and el2["kind"] not in ("badge", "pill"):
            if sig(cur) == sig(el2):
                return el2
        elif kind == "frame" and el2["kind"] == "frame" and el2["name"] == cur["name"]:
            return el2
        elif kind == "glow" and el2["kind"] == "glow" and el2["name"] == cur["name"]:
            return el2
        elif kind == "line" and el2["kind"] == "line" and el2["name"] == cur["name"] and el2["w"] == cur["w"]:
            return el2
    return None


def link(seg):
    links, absorbed = {}, set()
    for i, sid in enumerate(seg):
        for el in SLIDES[sid]["els"]:
            if (sid, el["name"]) in absorbed:
                continue
            chain, cur = [], el
            for sid2 in seg[i + 1:]:
                nxt = match(cur, sid2, absorbed)
                if nxt is None:
                    break
                chain.append((sid2, nxt))
                if not nxt.get("_synth"):
                    absorbed.add((sid2, nxt["name"]))
                cur = nxt
            if chain:
                links[(sid, el["name"])] = chain
    return links, absorbed


# ---------------------------------------------------------------- timeline
def timeline(sid, secs, base=0, absorbed=()):
    """Entry times for one state. Elements absorbed by a persisting layer are not built."""
    els = [el for el in SLIDES[sid]["els"] if (sid, el["name"]) not in absorbed]
    head_end, seen = 0, {}
    for el in els:
        if el["kind"] in ("hero", "statement", "block"):
            s0, st, dur = BEAT[el["kind"]]
            n = seen.get(el["kind"], 0); seen[el["kind"]] = n + 1
            head_end = max(head_end, s0 + st * n + dur)
    content = [el for el in els if el.get("g") is not None]
    G = (max(el["g"] for el in content) + 1) if content else 0
    limit = secs * 1000 - EXIT_LEAD
    cbase = base + (max(head_end, 700) if head_end else 150)
    if G > 1:
        intra_max = max(INTRA[el["kind"]][0] + el["k"] * INTRA[el["kind"]][2] + INTRA[el["kind"]][1] for el in content)
        st = (base + limit - cbase - intra_max) / (G - 1)
        st = max(ST_MIN, min(SLIDES[sid].get("st", ST_MAX), st))
    else:
        st = 0
    items, seen = [], {}
    for el in els:
        kind = el["kind"]
        if el.get("g") is None:
            s0, sg, dur = BEAT[kind]
            n = seen.get(kind, 0); seen[kind] = n + 1
            pre = PREROLL if (base > 0 and kind in ("hero", "statement", "block", "kicker")) else 0
            at = base + s0 + sg * n - pre if kind in ("hero", "statement", "block", "kicker") else base + max(head_end, 700) + s0 + sg * n
        else:
            off, dur, sub = INTRA[kind]
            at = cbase + el["g"] * st + off + el["k"] * sub
        items.append((el, at, dur))
    last = max([at + dur for _e, at, dur in items] + [base])
    if last > base + limit:
        raise SystemExit("%s: build ends %d ms, limit %d" % (sid, last - base, limit))
    return items, last - base


def assign_exits(items, end_ms):
    """Reverse entry order, fanned by EXIT_STAG but always finished by end_ms."""
    order = sorted(range(len(items)), key=lambda i: -items[i][1])
    stag = min(EXIT_STAG, (EXIT_LEAD - EXIT_DUR) / max(1, len(order) - 1))
    return {i: end_ms - EXIT_LEAD + stag * rank for rank, i in enumerate(order)}


# ---------------------------------------------------------------- emission
class Emitter:
    def __init__(self):
        self.o, self.verify = [], []

    def w(self, s):
        self.o.append(s)

    @staticmethod
    def stack_order(items):
        """AE stacks later layers on top: panels/frames first, images/units, text last."""
        rank = {"glow": 0, "panel": 0, "card": 0, "frame": 1, "unit": 1, "line": 2, "arrow": 2, "icon": 3, "chip": 3, "qr": 3, "svgicon": 3, "badge": 4, "pill": 4}
        return sorted(range(len(items)), key=lambda i: (rank.get(items[i][0]["kind"], 9), i))

    def create(self, sid, el, vtime, cname):
        kind, name, w = el["kind"], el["name"], self.w
        if kind == "glow":
            w('var G = glowPanel(c, %s, %.3f, %.3f, %.3f, %.3f, %.3f, %s, %.2f, %s, %d, %.4f, %s);'
              % (js(name), el["x"], el["y"], el["w"], el["h"], el["r"], "true" if el["dark"] else "false",
                 el["sw"], c3(el["scol"]), el["sop"], vtime, "true" if el.get("center") else "false"))
            thr = el.get("thr", 60)
            self.verify.append(dict(comp=cname, sid=sid, name=name, rect=list(el["rect"]), mode="lum", thr=thr,
                                    t=vtime, expect=list(ink(sid, el["rect"], thr=thr))))
            return "G"
        if kind in ("frame", "line", "badge", "pill", "panel", "card", "icon", "chip", "arrow", "qr", "unit", "svgicon"):
            if kind == "svgicon":
                w('var S = svgShape(c, %s, %s, %.2f, %.2f, %s, %.2f);'
                  % (js(name), json.dumps(el["paths"], separators=(",", ":")), el["x"], el["y"], c3(el["color"]), el["sw"]))
            elif kind == "unit":
                x, y, fw, fh, r = el["x"], el["y"], el["w"], el["h"], el["r"]
                sw, center = el.get("sw", 1), False
                if el.get("align") == "O":
                    x, y, fw, fh, r, center = x - sw / 2, y - sw / 2, fw + sw, fh + sw, r + sw / 2, True
                elif el.get("align") == "C":
                    center = True
                bm = el["bitmap"]
                w('var S = unitLayer(c, %s, %.3f, %.3f, %.3f, %.3f, %.3f, %s, %s, %.2f, %s, %s, %.3f, %.3f, %.4f, %.2f);'
                  % (js(name), x, y, fw, fh, r, c3(el["fill"]), c3(el["color"]) if sw > 0 else "null", sw,
                     "true" if center else "false", js((AE_ROOT / bm["file"]).as_posix()), bm["x"], bm["y"], bm["scale"],
                     SLIDES[sid]["secs"] + 2))
            elif kind == "arrow":
                w('var S = arrow(c, %s, %.2f, %.2f, %.2f, %.2f, %.2f, %.2f, %s);'
                  % (js(name), el["x1"], el["y"], el["x2"], el["hx"], el["hy"], el["sw"], c3(el["color"])))
            elif kind == "frame":
                x, y, fw, fh, r = el["x"], el["y"], el["w"], el["h"], el["r"]
                sw, center = el.get("sw", 1), False
                if el.get("align") == "O":                 # outside stroke = a centred stroke on a box grown by sw/2
                    x, y, fw, fh, r, center = x - sw / 2, y - sw / 2, fw + sw, fh + sw, r + sw / 2, True
                elif el.get("align") == "C":
                    center = True
                stroke = c3(el["color"]) if sw > 0 else "null"
                fill = c3(el["fill"]) if el.get("fill") else "null"
                w('var S = rrect(c, %s, %.3f, %.3f, %.3f, %.3f, %.3f, %s, %s, %.2f, %s);'
                  % (js(name), x, y, fw, fh, r, fill, stroke, sw, "true" if center else "false"))
            elif kind == "line" and "x2" in el:
                w('var S = line2(c, %s, %.3f, %.3f, %.3f, %.3f, %s, %.2f);'
                  % (js(name), el["x"], el["y"], el["x2"], el["y2"], c3(el["color"]), el.get("sw", 1)))
            elif kind == "line":
                w('var S = hline(c, %s, %.3f, %.3f, %.3f, %s);' % (js(name), el["x"], el["y"], el["w"], c3(el["color"])))
            elif kind in ("badge", "pill"):
                w('var S = rrect(c, %s, %.3f, %.3f, %.3f, %.3f, %.3f, %s, null, 0);'
                  % (js(name), el["x"], el["y"], el["w"], el["h"], el["r"], c3(el["color"])))
            elif kind in ("icon", "qr") and el.get("fit", True) is False:
                w('var S = png(c, %s, %s, %.3f, %.3f, %.4f);' % (js(name), js((AE_ROOT / el["file"]).as_posix()), el["x"], el["y"], el["scale"]))
                w('centerSelf(S);')
                return "S"                                   # exact geometry: checked by the whole-frame diff
            elif kind == "icon":
                ix, iy, isc = icon_fit(sid, el)
                w('var S = png(c, %s, %s, %.2f, %.2f, %.3f);' % (js(name), js((AE_ROOT / el["file"]).as_posix()), ix, iy, isc))
            else:
                w('var S = png(c, %s, %s, %d, %d, %d);'
                  % (js(name), js((AE_ROOT / el["file"]).as_posix()), int(round(el["x"])), int(round(el["y"])), el["scale"]))
            thr = el.get("thr", 60)
            if kind in ("icon", "pill", "chip", "badge", "unit") or (kind == "frame" and el.get("_flavour") == "settle"):
                w('centerSelf(S);')                       # these settle in about their centre
            if el.get("key"):
                self.verify.append(dict(comp=cname, sid=sid, name=name, rect=list(el["rect"]), mode="key", key=el["key"],
                                        t=vtime, expect=list(ink(sid, el["rect"], key=el["key"]))))
            else:
                self.verify.append(dict(comp=cname, sid=sid, name=name, rect=list(el["rect"]), mode="lum", thr=thr,
                                        t=vtime, expect=list(ink(sid, el["rect"], thr=thr))))
            return "S"
        tx, ty, tw_, th_ = ink(sid, el["rect"], el["color"], el.get("thr"), el.get("key"), el.get("core"), el["size"])
        fitted = fit_lines(sid, el)
        w('var L = txtBox(c, %s, %s, %s, %.2f, %s, %.2f, %s, %d);'
          % (js(name), js(fitted), js(el["font"]), el["size"], c3(el["color"]), el["leading"],
             js(el["justify"]), el["track"]))
        for i, ch in enumerate(fitted):
            if ch == ARROW:
                w('fontRange(L, %d, %d, "Inter-Regular");' % (i, i + 1))
        w('align(L, %d, %d);' % (tx, ty))
        for i in el.get("vt", []):                    # CharacterRange.tracking is absolute, not relative
            w('trackRange(L, %d, %d, %d);' % (map_idx(el, i), map_idx(el, i) + 1, el["track"] - 67))
        for a, b, rgb in el.get("ranges", []):        # range selectors skip "\r": index by rendered characters
            w('colorRange(L, %d, %d, %s);' % (ae_idx(fitted, map_idx(el, a)), ae_idx(fitted, map_idx(el, b)), c3(rgb)))
        if el.get("expr"):
            w('L.property("ADBE Text Properties").property("ADBE Text Document").expression = %s;' % js(el["expr"]))
        self.verify.append(dict(comp=cname, sid=sid, name=name, rect=list(el["rect"]), t=vtime, core=el.get("core"),
                                expect=[tx, ty, tw_, th_], size=el["size"], **vmode(sid, el)))
        return "L"

    def unit_text(self, sid, el, vtime, cname):
        """The digit of a badge / label of a pill: centred on the shape, keyed for verify."""
        cx, cy = el["x"] + el["w"] / 2, el["y"] + el["h"] / 2
        self.w('var L = txtBox(c, %s, %s, %s, %.2f, %s, %.2f, "center", %d);'
               % (js(el["name"] + "_t"), js(el["text"]), js(el["font"]), el["size"], c3(el["tcolor"]), el["size"],
                  -20 if el["kind"] == "pill" else 0))
        self.w('alignCenter(L, %.3f, %.3f);' % (cx, cy))
        tx, ty, tw_, th_ = ink(sid, el["trect"], key=el["key"])
        self.verify.append(dict(comp=cname, sid=sid, name=el["name"] + "_t", rect=list(el["trect"]), t=vtime,
                                expect=[tx, ty, tw_, th_], mode="key", key=el["key"]))
        return "L"

    def enter(self, h, el, at, dur):
        kind, w = el["kind"], self.w
        if h == "G":
            w('glowIn(G, %d, %d);' % (at, dur))
            return
        w('var rest = pos(%s).value;' % h)
        if kind in CASCADE:
            rise, blur = CASCADE[kind]
            fn = "cascadeR" if el.get("justify") == "right" else "cascade"
            w('%s(%s, %d, %d, %d, %d);' % (fn, h, at, dur, rise, blur))
        elif kind == "unit":
            w('settleIn(%s, %d, %d, 0.94, 14);' % (h, at, max(dur, 900)))        # plate and bitmap land as one object
        elif kind == "icon" and el.get("fit", True) is False:
            w('settleIn(%s, %d, %d, 0.96, 6);' % (h, at, max(dur, 800)))       # a large bitmap: the gentlest settle
        elif kind in ("icon", "chip", "pill", "badge"):
            s0, bl = {"icon": (0.88, 8), "chip": (0.94, 6), "pill": (0.94, 6), "badge": (0.9, 6)}[kind]
            w('settleIn(%s, %d, %d, %.2f, %d);' % (h, at, dur, s0, bl))
        elif kind == "frame" and el.get("_flavour") == "settle":
            w('settleIn(%s, %d, %d, 0.975, 4);' % (h, at, dur))
        elif kind in ("frame", "line", "arrow", "svgicon"):
            w('drawOn(%s, %d, %d);' % (h, at, dur))
        else:
            rise = {"panel": 16, "card": 24}.get(kind, 14)
            w('tw(opa(%s), %d, %d, 0, 100, "in");' % (h, at, at + dur * 0.7))
            w('tw(pos(%s), %d, %d, [rest[0], rest[1] + %d], [rest[0], rest[1]], "in");' % (h, at, at + dur, rise))
        w('%s.inPoint = f(%d);' % (h, max(0, at - 40)))

    def exit(self, h, el, ex, rest_expr="rest", drop=True):
        if h == "G" or h.startswith("K_") and el["kind"] == "glow":
            self.w('glowOut(%s, %d, %d);' % (h, ex, EXIT_DUR))
            return
        self.w('tw(opa(%s), %d, %d, 100, 0, "out");' % (h, ex, ex + EXIT_DUR))
        if el["kind"] in ("unit", "pill", "icon", "chip", "badge") or (el["kind"] == "frame" and el.get("_flavour") == "settle"):
            self.w('settleOut(%s, %d, %d, 0.97, 4);' % (h, ex, EXIT_DUR))
            return
        if drop and el["kind"] not in ("frame", "line", "arrow", "unit", "svgicon"):
            dx, dy = (-26, 0) if el.get("_flavour") == "settle" else (0, -22)
            self.w('tw(pos(%s), %d, %d, [%s[0], %s[1]], [%s[0] + %d, %s[1] + %d], "out");'
                   % (h, ex, ex + EXIT_DUR, rest_expr, rest_expr, rest_expr, dx, rest_expr, dy))

    def segment(self, seg):
        cname = seg_name(seg)
        starts, t = {}, 0.0
        for s in seg:
            starts[s] = t; t += SLIDES[s]["secs"]
        links, absorbed = link(seg)
        self.w("\n// ======== %s (%.1f s) ========" % (cname, t))
        self.w('var c = comp(%s, %.4f);' % (js(cname), t))
        for si, sid in enumerate(seg):
            secs = SLIDES[sid]["secs"]
            base = starts[sid] * 1000
            items, last = timeline(sid, secs, base, absorbed)
            self.w("// -- %s: %d..%d ms, build ends %d" % (sid, base, base + secs * 1000, last))
            ex = assign_exits(items, base + secs * 1000)
            vtime = (base + secs * 1000 - EXIT_LEAD) / 1000 - 0.06
            flavour = "settle" if (si % 2 == 1) else "draw"    # slides alternate: outlines draw on / cards settle in
            for i in self.stack_order(items):
                el, at, dur = items[i]
                el["_flavour"] = flavour
                chain = links.get((sid, el["name"]), [])
                h = self.create(sid, el, vtime, cname)
                if chain and h == "L":
                    self.w('var R_%s = L.sourceRectAtTime(0, false);' % el["name"])   # before the animator
                self.enter(h, el, at, dur)
                rest_var = "rest"
                if el["kind"] in ("badge", "pill"):
                    self.w("var restU = rest;")            # the label's `rest` must not leak into the shape's exit
                    rest_var = "restU"
                    h2 = self.unit_text(sid, el, vtime, cname)
                    self.enter(h2, dict(el, kind="unitText"), at + 60, dur)
                    self.exit(h2, dict(el, kind="unitText"), ex[i])
                    h = "S"
                if not chain:
                    self.exit(h, el, ex[i], rest_var)
                    continue
                var = "K_%s_%s" % (sid, el["name"])
                if h == "G":
                    self.w("var %s = G;" % var)
                else:
                    self.w("var %s = %s; var %s_rest = rest;" % (var, h, var))
                prev, cur, last_sid = var + "_rest", el, sid
                for sid2, el2 in chain:
                    cut = starts[sid2] * 1000
                    t0, t1 = cut - MOVE_PRE, cut - MOVE_PRE + MOVE_DUR
                    vt2 = (starts[sid2] * 1000 + SLIDES[sid2]["secs"] * 1000 - EXIT_LEAD) / 1000 - 0.06
                    if h == "L":
                        tx, ty, tw_, th_ = ink(sid2, el2["rect"], el2["color"], el2.get("thr"), el2.get("key"), el2.get("core"), el2["size"])
                        R = "R_%s" % el["name"]
                        if el2["justify"] != cur["justify"]:
                            self.w('retext(%s, %d, %s);' % (var, cut, js(el2["justify"])))
                            R = "R_%s_%s" % (el["name"], sid2)
                            self.w('var %s = %s.sourceRectAtTime(f(%d) + 0.02, false);' % (R, var, cut))
                        pv = "p_%s_%s" % (el["name"], sid2)
                        self.w('var %s = [%d - %s.left, %d - %s.top];' % (pv, tx, R, ty, R))
                        self.w('travel(%s, %d, %d, %s, %s);' % (var, t0, t1, prev, pv))
                        prev = pv
                        self.verify.append(dict(comp=cname, sid=sid2, name=el["name"], rect=list(el2["rect"]), t=vt2, core=el2.get("core"),
                                                expect=[tx, ty, tw_, th_], size=el2["size"], **vmode(sid2, el2)))
                    elif el["kind"] == "glow":
                        a = [cur["x"], cur["y"], cur["w"], cur["h"], cur["r"]]
                        b = [el2["x"], el2["y"], el2["w"], el2["h"], el2["r"]]
                        self.w('glowTravel(%s, %d, %d, %s, %s);' % (var, t0, t1, a, b))
                        thr = el2.get("thr", 60)
                        self.verify.append(dict(comp=cname, sid=sid2, name=el["name"], rect=list(el2["rect"]), t=vt2,
                                                mode="lum", thr=thr, expect=list(ink(sid2, el2["rect"], thr=thr))))
                    elif el["kind"] == "frame":
                        a = [cur["x"], cur["y"], cur["w"], cur["h"], cur["r"]]
                        b = [el2["x"], el2["y"], el2["w"], el2["h"], el2["r"]]
                        self.w('morph(%s, %d, %d, %s, %s, 0.5);' % (var, t0, t1, a, b))
                        self.verify.append(dict(comp=cname, sid=sid2, name=el["name"], rect=list(el2["rect"]), t=vt2,
                                                mode="lum", thr=60, expect=list(ink(sid2, el2["rect"], thr=60))))
                    elif el["kind"] == "line":
                        pv = "p_%s_%s" % (el["name"], sid2)
                        self.w('var %s = [%.3f, %.3f];' % (pv, el2["x"] - el["x"], el2["y"] - el["y"]))
                        self.w('travel(%s, %d, %d, %s, %s);' % (var, t0, t1, prev, pv))
                        prev = pv
                        self.verify.append(dict(comp=cname, sid=sid2, name=el["name"], rect=list(el2["rect"]), t=vt2,
                                                mode="lum", thr=30, expect=list(ink(sid2, el2["rect"], thr=30))))
                    cur, last_sid = el2, sid2
                if h in ("L", "S") and el["kind"] not in ("frame", "glow"):
                    self.w('ease(pos(%s), 60, 60);' % var)
                end = (starts[last_sid] + SLIDES[last_sid]["secs"]) * 1000
                self.exit(var, el, end - EXIT_LEAD + 20, prev, drop=False)


def emit_master():
    o = ['\n// ======== master ========']
    total = sum(SLIDES[s]["secs"] for seg in SEGMENTS for s in seg)
    o.append('var m = comp(%s, %.4f);' % (js(MASTER), total))
    o.append('var blk = m.layers.addSolid([0, 0, 0], "BLACK", W, H, 1, %.4f);' % total)
    starts, t = {}, 0.0
    for seg in SEGMENTS:
        starts[seg_name(seg)] = t
        for s in seg:
            starts[s] = t; t += SLIDES[s]["secs"]
    order = [s for seg in SEGMENTS for s in seg]
    for i, s in enumerate(order):
        if not SLIDES[s].get("art"):
            continue
        t_in, t_out = starts[s], starts[s] + SLIDES[s]["secs"]
        vt = t_out - EXIT_LEAD / 1000 - 0.06                 # the verified rest time of the slide
        o.extend(artkit.art_js(s, t_in, t_out, i == 0, TX, vt))
    for seg in SEGMENTS:
        cname = seg_name(seg)
        dur = sum(SLIDES[s]["secs"] for s in seg)
        o.append('var sc = null;')
        o.append('for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i);'
                 ' if (it instanceof CompItem && it.name === %s) sc = it; }' % js(cname))
        o.append('if (!sc) throw new Error("missing %s");' % cname)
        o.append('var sl = m.layers.add(sc);')
        o.append('sl.startTime = %.4f; sl.inPoint = %.4f; sl.outPoint = %.4f;' % (starts[cname], starts[cname], starts[cname] + dur))
    return "\n".join(o), starts, total


def wrap(body, tag):
    return "\n".join(["JSON.stringify((function () {", HEAD_V4 % FPS, HEAD_EXTRA, artkit.head_consts(), artkit.HEAD_ART,
                      'app.beginUndoGroup("gct-deck-%s");' % tag, "try {", body,
                      "} catch (err) {", "  app.endUndoGroup();",
                      "  return { ok: false, error: err.toString(), line: err.line };", "}",
                      "app.endUndoGroup();", "return { ok: true };", "})());"])


PARTS = {"A": SEGMENTS[0:5], "B": SEGMENTS[5:8], "C": SEGMENTS[8:13], "D": SEGMENTS[13:14]}

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    build = ROOT / "_build"
    FILM = sys.argv[1] if len(sys.argv) > 1 else "1"
    SUFFIX = ""
    if FILM != "hand":
        import figspec
        new = figspec.build(FILM)
        SLIDES.clear(); SLIDES.update(new)
        SEGMENTS[:] = [list(figspec.FILMS[FILM])]
        INTRA.update(figspec.INTRA_FILMS)
        PARTS = {"F%s" % FILM: SEGMENTS}
        MASTER = "PRESENTATION_%s" % FILM
        SUFFIX = "_" + FILM
    master_src, starts, total = emit_master()
    verify_all = []
    for tag, segs in PARTS.items():
        em = Emitter()
        for seg in segs:
            em.segment(seg)
        (build / f"deck_{tag}.jsx").write_text(wrap("\n".join(em.o), tag), encoding="ascii")
        for v in em.verify:
            v["t_master"] = round(starts[v["comp"]] + v["t"], 3)
            verify_all.append(v)
        print("deck_%s.jsx: %d chars, %d verify points" % (tag, sum(len(s) for s in em.o), len(em.verify)))
    (build / ("deck_M%s.jsx" % SUFFIX)).write_text(wrap(master_src, "M"), encoding="ascii")
    json.dump(dict(master=MASTER, points=verify_all) if SUFFIX else verify_all,
              open(build / ("deck_verify%s.json" % SUFFIX), "w", encoding="utf-8"), indent=0, ensure_ascii=False)
    print("master %.1f s" % total)
    for seg in SEGMENTS:
        links, absorbed = link(seg)
        if links:
            print("  %s persists: %s" % (seg_name(seg), ", ".join("%s/%s->%s" % (k[0], k[1], "/".join(s for s, _ in ch)) for k, ch in links.items())))
        for sid in seg:
            items, last = timeline(sid, SLIDES[sid]["secs"], 0, absorbed)
            print("  %s: %2d layers, build ends %4d of %4d ms" % (sid, len(items), last, SLIDES[sid]["secs"] * 1000))
    print("\n".join(FIT_LOG))
