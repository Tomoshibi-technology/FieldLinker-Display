import csv
import math
import os

def export_units(sector_paths, order_map, neo_pixel, mlcc):
    neo_rows = []
    mlcc_rows = []
    for sector, points in sorted(sector_paths.items()):
        # Sectorの値を "Sector0" のような文字列と仮定し、数字部分から文字を生成
        letter = chr(65 + sector)
        sector_counter = 0
        for r, theta in points:
            order = order_map.get((r, theta))
            rotation = theta + math.pi if order == "ascending" else theta
            rotation_degrees = math.degrees(rotation)
            np_x = (r + neo_pixel["offset"]) * math.cos(theta)
            np_y = (r + neo_pixel["offset"]) * math.sin(theta)
            # ラベルは例: "A0", "A1", ... または "B0", "B1", ...
            sector_label = f"{letter}{sector_counter}"
            sector_counter += 1
            neo_rows.append([np_x, -np_y, rotation_degrees+90, sector_label])
            mlcc_x = (r + mlcc["offset"]) * math.cos(theta)
            mlcc_y = (r + mlcc["offset"]) * math.sin(theta)
            mlcc_rows.append([mlcc_x, -mlcc_y, rotation_degrees+270, sector_label])
    # CSV出力: NeoPixel用
    output_file_np = os.path.join(os.path.dirname(__file__), 'units_neopixel.csv')
    with open(output_file_np, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['ID', 'Part Number', 'x', 'y', 'rotation', 'sector'])
        id_counter = 1
        for row in neo_rows:
            part_number = f"D{id_counter}"
            writer.writerow([id_counter, part_number] + row)
            id_counter += 1
    # CSV出力: MLCC用
    output_file_mlcc = os.path.join(os.path.dirname(__file__), 'units_mlcc.csv')
    with open(output_file_mlcc, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['ID', 'Part Number', 'x', 'y', 'rotation', 'sector'])
        id_counter = 1
        for row in mlcc_rows:
            part_number = f"C{id_counter}"
            writer.writerow([id_counter, part_number] + row)
            id_counter += 1

if __name__ == '__main__':
    # テスト用コード
    export_units({}, {}, {}, {})
