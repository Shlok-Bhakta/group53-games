#!/usr/bin/env python3
import io
import os
import tarfile
import urllib.request

ENABLE = "https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt"
SCOWL = "https://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz"
COUNTS = "https://norvig.com/ngrams/count_1w.txt"
ANSWERS = 2000
COMMON_LEVEL = 35
LEFT_OUT = set(
    """
    pussy penis horny bitch sperm spank whore kinky semen enema fagot sissy queer booty slave lynch titty gayer nuder
    bigot feces fecal prick thong urine vomit moron idiot smith peter harry carol sally maria sandy frank dolly patty
    holly booby gimme busty dildo porno nazis jihad gypsy bosom buxom lusty groin ovary uteri fetus weest unman
    """.split()
)


def fetch(url):
    with urllib.request.urlopen(url) as r:
        if r.status != 200:
            raise SystemExit(f"{url}: {r.status}")
        return r.read()


def main():
    enable = set(fetch(ENABLE).decode().split())
    if len(enable) < 170_000:
        raise SystemExit("ENABLE came back short")
    common = set()
    with tarfile.open(fileobj=io.BytesIO(fetch(SCOWL))) as tar:
        for m in tar.getmembers():
            name = os.path.basename(m.name)
            kind, _, level = name.rpartition(".")
            if kind in ("english-words", "american-words") and level.isdigit() and int(level) <= COMMON_LEVEL:
                common |= set(tar.extractfile(m).read().decode("latin-1").split())
    rank = {}
    for i, line in enumerate(fetch(COUNTS).decode().splitlines()):
        rank.setdefault(line.split("\t")[0], i)

    def inflected(w):
        if w.endswith("ies") and w[:-3] + "y" in enable:
            return True
        if w.endswith("ied") and w[:-3] + "y" in enable:
            return True
        if w.endswith("ed") and (w[:-2] in enable or w[:-1] in enable):
            return True
        if w.endswith(("ss", "us", "is")):
            return False
        return (w.endswith("s") and w[:-1] in enable) or (w.endswith("es") and w[:-2] in enable)

    guesses = sorted(w for w in enable if len(w) == 5 and w.isalpha())
    answers = [w for w in guesses if w in common and w not in LEFT_OUT and not inflected(w)]
    answers.sort(key=lambda w: rank.get(w, 10**9))
    answers = sorted(answers[:ANSWERS])
    if len(answers) < ANSWERS:
        raise SystemExit(f"only {len(answers)} answers")
    root = os.path.join(os.path.dirname(__file__), "..", "convex", "wordle")
    with open(os.path.join(root, "words.ts"), "w") as f:
        f.write(f'export const GUESSES = "{"".join(guesses)}";\n')
    with open(os.path.join(root, "answers.ts"), "w") as f:
        f.write(f'export const ANSWERS = "{"".join(answers)}";\n')


main()
