import math

def polar_to_cartesian(point):
    # (r, theta) を (x, y) に変換
    r, theta = point
    return (r * math.cos(theta), r * math.sin(theta))

def euclidean_distance(p1, p2):
    x1, y1 = polar_to_cartesian(p1)
    x2, y2 = polar_to_cartesian(p2)
    return math.sqrt((x1 - x2)**2 + (y1 - y2)**2)

def greedy_path(points):
    # points: [(r, theta), ...]
    # グリーディ法で点を最短距離順に並べる
    if not points:
        return []
    remaining = points[:]
    path = [remaining.pop(0)]
    while remaining:
        current = path[-1]
        next_point = min(remaining, key=lambda p: euclidean_distance(current, p))
        path.append(next_point)
        remaining.remove(next_point)
    return path

def continuous_sector_path(polar_points, center=(0, 0), sectors=0, unit_const=0, theta_offset=0):
    """
    極座標の点群(polar_points: [(r, theta), ...])を入力し、
    中心との距離により内側～外側の順にソート後、
    指定した扇形(sectors)ごとに分類して各扇形内のパスを返す。
    各扇形は半径unit_constでユニットに分割され、
    最も内側のユニットはθの昇順、その外側は降順と交互に点を結ぶ。
    theta_offset: セクター分割基準となるθ値の回転オフセット
    """
    # 扇形1つあたりの角度
    sector_angle = 2 * math.pi / sectors
    # 各扇形での点リストを初期化
    sectors_points = {i: [] for i in range(sectors)}
    # 1. 各点を極座標に基づき各扇形に分類（adjusted_thetaを保存）
    for (r, theta) in polar_points:
        # theta_offsetを反映
        adjusted_theta = (theta + theta_offset) % (2 * math.pi)
        index = int(adjusted_theta // sector_angle)
        if index >= sectors:
            index = sectors - 1
        sectors_points[index].append({'point': (r, theta), 'r': r, 'theta': theta, 'adjusted_theta': adjusted_theta})
    # 2. 各扇形内を内側から外側にソート
    for i in range(sectors):
        sectors_points[i].sort(key=lambda p: p['r'])
    # 各扇形ごとのパスを生成
    sector_paths = {}
    order_map = {}  # 各点のcurrent_orderを保存する
    for i in range(sectors):
        # ptは ( (r, theta), adjusted_theta )
        pts = [(p['point'], p['adjusted_theta']) for p in sectors_points[i]]
        # ユニット毎に点を分割（unit_constごと）
        units = {}
        for pt, adj_theta in pts:
            r, _ = pt
            unit_key = int(r // unit_const)
            units.setdefault(unit_key, []).append((pt, adj_theta))
        # 各ユニット内の並びを、adjusted_thetaを使ってソート
        ordered_units = []
        prev_order = None
        for idx, key in enumerate(sorted(units.keys())):
            unit_points = units[key]
            unit_points.sort(key=lambda item: item[1])
            if idx == 0:
                # 最も内側のユニット：θ昇順でソート後、rの先頭と末尾を比較して順序調整
                if unit_points[0][0][0] > unit_points[-1][0][0]:
                    unit_points.reverse()
                    current_order = "descending"
                else:
                    current_order = "ascending"
            else:
                # 前のユニットの順序と反対にする
                if prev_order == "ascending":
                    unit_points.reverse()
                    current_order = "descending"
                else:
                    current_order = "ascending"
            # 各点にソート順を付与
            for pt, adj_theta in unit_points:
                ordered_units.append(pt)
                order_map[pt] = current_order
            prev_order = current_order
        sector_paths[i] = ordered_units
    # 各セクターの要素数を計算
    sector_counts = {i: len(paths) for i, paths in sector_paths.items()}
    return sector_paths, order_map, sector_counts  # 返り値を更新

# 例:
# polar_points = フィロタキシスなどで生成した極座標点群（[(r, theta), ...] のリスト）
# path = continuous_sector_path(polar_points, center=(0,0), sectors=6)
