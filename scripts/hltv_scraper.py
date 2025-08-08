import requests
from bs4 import BeautifulSoup
import csv

URL = "https://www.hltv.org/stats/players?startDate=2025-05-08&endDate=2025-08-08&maps=de_ancient&rankingFilter=Top30&side=TERRORIST"

headers = {
    "User-Agent": "Mozilla/5.0"
}

resp = requests.get(URL, headers=headers)
soup = BeautifulSoup(resp.text, "html.parser")
table = soup.find("table", class_="stats-table")

rows = []
for tr in table.find_all("tr")[1:]:  # пропускаем заголовки
    cols = [td.get_text(strip=True) for td in tr.find_all("td")]
    if cols:
        rows.append(cols)

with open("data/hltv_players.csv", "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f)
    writer.writerow(["Player", "Team", "Maps", "K/D Diff", "K/D", "Rating 2.0"])
    writer.writerows(rows)
