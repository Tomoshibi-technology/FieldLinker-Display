import math
import matplotlib.pyplot as plt
from matplotlib.collections import PatchCollection
from polar_utils import continuous_sector_path
from matplotlib.patches import Polygon

def generate_polar_points(N, R, alpha):
    points = []
    for i in range(1, N + 1):
        # 半径は平方根スケーリングを適用
        radius = R * math.sqrt(i / N)
        # 角度は黄金角に基づく加算後に 2π で丸める
        angle = (i * alpha) % (2 * math.pi)
        points.append((radius, angle))
    return points

def plot_sector_boundaries(R, sectors, ax=None):
    # 扇形の境界線を描画
    if ax is None:
        ax = plt.gca()
    sector_angle = 2 * math.pi / sectors
    for i in range(sectors + 1):
        angle = i * sector_angle
        x_line = [0, R * math.cos(angle)]
        y_line = [0, R * math.sin(angle)]
        ax.plot(x_line, y_line, color='black', linestyle='--', linewidth=0.5)

# 色を暗くする関数
def darken_color(hex_color, factor=0.8):
    # hex_color: '#rrggbb'
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    r = int(r * factor)
    g = int(g * factor)
    b = int(b * factor)
    return f"#{r:02x}{g:02x}{b:02x}"

# 回転と移動を適用して長方形を描画
def draw_rotated_rectangle(ax, r, polar_theta, width, height, offset=0, label=None, rect_rotation=0, quad_colors=None):
    x_center = (r + offset) * math.cos(polar_theta)
    y_center = (r + offset) * math.sin(polar_theta)
    
    def rotate_point(x, y, angle):
        return (math.cos(angle) * x - math.sin(angle) * y,
                math.sin(angle) * x + math.cos(angle) * y)
    
    def transform_points(points):
        # 一度だけ rotate_point を呼び出すことで座標変換を実施
        return [(rx + x_center, ry + y_center) for (rx, ry) in (rotate_point(x, y, rect_rotation) for x, y in points)]
    
    # 4分割するために、中心 (0,0) で縦横に分割された4つのクォードラントを定義
    q1 = [(0, 0), (width/2, 0), (width/2, height/2), (0, height/2)]
    q2 = [(-width/2, 0), (0, 0), (0, height/2), (-width/2, height/2)]
    q3 = [(-width/2, -height/2), (0, -height/2), (0, 0), (-width/2, 0)]
    q4 = [(0, -height/2), (width/2, -height/2), (width/2, 0), (0, 0)]
    
    q1_coords = transform_points(q1)
    q2_coords = transform_points(q2)
    q3_coords = transform_points(q3)
    q4_coords = transform_points(q4)
    
    # quad_colorsが指定されていればその色を使い、なければデフォルトの基準色から暗くする実装を使用
    if quad_colors and len(quad_colors) == 4:
        col1, col2, col3, col4 = quad_colors
    else:
        base = "#888888"
        col1 = col2 = col3 = col4 = base
    poly_q1 = Polygon(q1_coords, facecolor=col1, edgecolor="none", label=label)
    poly_q2 = Polygon(q2_coords, facecolor=col2, edgecolor="none")
    poly_q3 = Polygon(q3_coords, facecolor=col3, edgecolor="none")
    poly_q4 = Polygon(q4_coords, facecolor=col4, edgecolor="none")
    
    return [poly_q1, poly_q2, poly_q3, poly_q4]

def get_adjusted_rotation(theta, order):
    # orderに基づいて回転角度を調整
    return theta + math.pi if order == "ascending" else theta

def draw_units(ax, r, theta, neo, mlcc, order, label_np, label_ml):
    # ユニット (NeoPixel, MLCC) の描画処理を統合
    rotation = get_adjusted_rotation(theta, order)
    units = []
    units.extend(
        draw_rotated_rectangle(
            ax, r, theta,
            neo["width"], neo["height"],
            offset=neo["offset"],
            label=label_np,
            rect_rotation=rotation,
            quad_colors=neo.get("quad_colors")
        )
    )
    units.extend(
        draw_rotated_rectangle(
            ax, r, theta,
            mlcc["width"], mlcc["height"],
            offset=mlcc["offset"],
            label=label_ml,
            rect_rotation=rotation,
            quad_colors=mlcc.get("quad_colors")
        )
    )
    return units

def main():
    # パラメータ設定
    N =1200         # 点の総数
    comp_phy = 173   # 円の半径
    board_phi = 176  # 円の半径
    alpha = math.pi * (3 - math.sqrt(5))
    sectors = 6
    unit_const = 3.8

    #-------------------------------------------------------------------------------------------
    # FigureとAxesを初期化
    plt.figure(figsize=(6,6))
    ax = plt.gca()  # Axesを取得

    # 2つの円を描画
    for radius, c in [(comp_phy/2, 'blue'), (board_phi/2, 'skyblue')]:
        circle = plt.Circle((0, 0), radius, fill=False, color=c, linestyle='--')
        ax.add_artist(circle)

    # 同心円を描画
    max_r = board_phi/2.0
    k = 1
    while k * unit_const < max_r:
        circle_ring = plt.Circle((0, 0), k * unit_const, fill=False,
                                color='gray', linestyle='dashdot', linewidth=0.5)
        ax.add_artist(circle_ring)
        k += 1

    #-------------------------------------------------------------------------------------------
    # 極座標の点を生成
    polar_points = generate_polar_points(N, comp_phy/2, alpha)
    
    # theta_offsetの調整ループ: sector_countsの全要素が一致するまで実行
    theta_offset = 0.0
    while True:
        sector_paths, order_map, sector_counts = continuous_sector_path(
            polar_points, center=(0, 0), sectors=sectors, unit_const=unit_const, theta_offset=theta_offset
        )
        print("Current theta_offset:", theta_offset, sector_counts)
        if len(set(sector_counts.values())) == 1:
            break
        theta_offset += 0.01
        if theta_offset > 2*math.pi:
            break
    print("Final theta_offset:", theta_offset)
    print("Sector counts:", sector_counts)

    # 扇形の境界線を描画
    plot_sector_boundaries(board_phi/2.0, sectors, ax)
    
    # ユニットごとの定数を設定
    neo_pixel = {
        "quad_colors": ["#33eeee","#ff3333", "#eeee33", "#333333"],
        "width": 2.2, "height": 3.2, "offset": 0
    }
    mlcc = {
        "quad_colors": ["#ff9999", "#ff9999", "#9999ff", "#9999ff"],
        "width": 1.1, "height": 2.0, "offset": -1.6
    }
    
    # CSV出力部分（CSV書き出し処理は output.py に実装）
    from output import export_units
    export_units(sector_paths, order_map, neo_pixel, mlcc)
    
    # ユニット (NeoPixel, MLCC) を全ての極座標点で描画
    all_rectangles = []
    for idx, (r, theta) in enumerate(polar_points):
        current_order = order_map.get((r, theta))  # 各点のorder取得
        label_np = "NeoPixel" if idx == 0 else None
        label_ml = "MLCC" if idx == 0 else None
        all_rectangles.extend(
            draw_units(ax, r, theta, neo_pixel, mlcc, current_order, label_np, label_ml)
        )
    pc = PatchCollection(all_rectangles, match_original=True)
    ax.add_collection(pc)
    
    # 極座標から直交座標へ変換した点を描画（赤色）
    xs, ys = zip(*[(r * math.cos(theta), r * math.sin(theta)) for r, theta in polar_points])
    ax.scatter(xs, ys, color='red', s=1, zorder=1)
    
    # 各扇形のパスを描画
    pathColors = ['green', 'orange', 'purple', 'cyan', 'magenta', 'yellow']
    for i, path in sector_paths.items():
        if len(path) > 1:
            cartesian_line = [(r * math.cos(theta), r * math.sin(theta)) for r, theta in path]
            xs, ys = zip(*cartesian_line)
            plt.plot(xs, ys, color=pathColors[i % len(pathColors)], linewidth=2, label=f'Sector {i} path')
    
    # 最終調整と表示
    ax.set_aspect('equal', adjustable='box')
    plt.title(f'{N} points and paths for each sector')
    plt.xlabel('X')
    plt.ylabel('Y')
    plt.grid(True)
    plt.legend()
    plt.show()

if __name__ == '__main__':
    main()

