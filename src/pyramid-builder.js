/**
 * Pyramid Builder for GeoGebra 3D
 * Generates GeoGebra commands for 3D pyramids (hình chóp)
 * Tailored for Vietnamese High School Geometry (Toán 11, 12, ĐGNL, THPT QG)
 */

function roundNum(n) {
  return Math.round(n * 1000) / 1000;
}

function ptStr(x, y, z) {
  return `(${roundNum(x)}, ${roundNum(y)}, ${roundNum(z)})`;
}

/**
 * Builds GeoGebra commands to draw a 3D pyramid
 * @param {Object} options 
 * @returns {{ commands: string[], explanation: string, points: Object, volumeFormula: string }}
 */
function buildPyramidCommands(options = {}) {
  const {
    type = 'tam_giac', // 'tam_giac' | 'tu_giac' | 'chop_deu'
    base_shape = 'tam_giac_vuong_A',
    height_type = 'SA_vuong_goc_day',
    dimensions = {},
    labels = {},
    draw_height = true,
    draw_base_diagonals = true,
    opacity = 0.25,
    color = '#2563eb', // blue
    height_color = '#dc2626', // red
    extra_points = [],
    planes = [],
    show_axes = false,
    show_grid = false
  } = options;

  const a = Number(dimensions.a) || 4;
  const b = Number(dimensions.b) || 3;
  const c = Number(dimensions.c) || 4;
  const h = Number(dimensions.h) || 5;

  const apexLabel = labels.apex || 'S';
  const footLabel = labels.height_foot; // Giữ nguyên để từng loại đường cao chọn ký hiệu mặc định phù hợp (H, O, G)
  const baseLabels = labels.base || (type === 'tam_giac' ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D']);

  let pts = {};
  let foot = null;
  let explanationLines = [];
  let basePolygonPoints = [];
  let diagonals = [];
  let baseArea = 0;

  // ==========================================
  // 1. TÍNH TỌA ĐỘ ĐÁY
  // ==========================================
  if (type === 'tam_giac' || base_shape.startsWith('tam_giac')) {
    const [lA, lB, lC] = baseLabels;
    basePolygonPoints = [lA, lB, lC];

    switch (base_shape) {
      case 'tam_giac_deu': {
        // Tam giác đều cạnh a
        // A=(0,0,0), B=(a,0,0), C=(a/2, a*sqrt(3)/2, 0)
        const hEq = (a * Math.sqrt(3)) / 2;
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [a / 2, hEq, 0];
        baseArea = (a * a * Math.sqrt(3)) / 4;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác đều cạnh a = ${a}`);
        break;
      }
      case 'tam_giac_vuong_B': {
        // Vuông tại B: BA = a (Oy), BC = sideBC (Ox)
        const sideBC = Number(dimensions.c) || Number(dimensions.b) || 4;
        pts[lB] = [0, 0, 0];
        pts[lA] = [0, a, 0];
        pts[lC] = [sideBC, 0, 0];
        baseArea = 0.5 * a * sideBC;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác vuông tại ${lB} (cạnh ${lB}${lA} = ${a}, ${lB}${lC} = ${sideBC})`);
        break;
      }
      case 'tam_giac_vuong_C': {
        // Vuông tại C: CA = b (Ox), CB = a (Oy)
        pts[lC] = [0, 0, 0];
        pts[lA] = [b, 0, 0];
        pts[lB] = [0, a, 0];
        baseArea = 0.5 * a * b;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác vuông tại ${lC} (cạnh ${lC}${lA} = ${b}, ${lC}${lB} = ${a})`);
        break;
      }
      case 'tam_giac_can': {
        // Cân tại A: BC = a nằm trên Ox, A đối xứng trên Oy
        const halfA = a / 2;
        const sideB = Math.max(b, halfA + 0.5);
        const hCan = Math.sqrt(sideB * sideB - halfA * halfA);
        pts[lB] = [0, 0, 0];
        pts[lC] = [a, 0, 0];
        pts[lA] = [halfA, hCan, 0];
        baseArea = 0.5 * a * hCan;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác cân tại ${lA} (đáy ${lB}${lC} = ${a}, cạnh bên = ${roundNum(sideB)})`);
        break;
      }
      case 'tam_giac_thuong': {
        // Tam giác thường với cạnh đáy AB = sideC, cạnh AC = b
        const sideC = Number(dimensions.c) || Math.sqrt(a * a + b * b - a * b);
        const cosA = Math.max(-0.99, Math.min(0.99, (b * b + sideC * sideC - a * a) / (2 * b * sideC)));
        const sinA = Math.sqrt(1 - cosA * cosA);
        pts[lA] = [0, 0, 0];
        pts[lB] = [sideC, 0, 0];
        pts[lC] = [roundNum(b * cosA), roundNum(b * sinA), 0];
        baseArea = 0.5 * sideC * b * sinA;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác thường (cạnh đáy ${lA}${lB} = ${roundNum(sideC)}, cạnh ${lA}${lC} = ${b})`);
        break;
      }
      case 'tam_giac_vuong_A':
      default: {
        // Vuông tại A: AB = a (Ox), AC = b (Oy)
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [0, b, 0];
        baseArea = 0.5 * a * b;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác vuông tại ${lA} (cạnh ${lA}${lB} = ${a}, ${lA}${lC} = ${b})`);
        break;
      }
    }
  } else {
    // TỨ GIÁC
    const [lA, lB, lC, lD] = baseLabels;
    basePolygonPoints = [lA, lB, lC, lD];

    switch (base_shape) {
      case 'hinh_vuong': {
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [a, a, 0];
        pts[lD] = [0, a, 0];
        baseArea = a * a;
        explanationLines.push(`- Đáy ${lA}${lB}${lC}${lD} là hình vuông cạnh a = ${a}`);
        break;
      }
      case 'hinh_chu_nhat': {
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [a, b, 0];
        pts[lD] = [0, b, 0];
        baseArea = a * b;
        explanationLines.push(`- Đáy ${lA}${lB}${lC}${lD} là hình chữ nhật (${lA}${lB} = ${a}, ${lA}${lD} = ${b})`);
        break;
      }
      case 'hinh_thoi': {
        // Góc BAD = 60 độ
        const rad60 = Math.PI / 3;
        const dx = a * Math.cos(rad60);
        const dy = a * Math.sin(rad60);
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lD] = [dx, dy, 0];
        pts[lC] = [a + dx, dy, 0];
        baseArea = a * a * Math.sin(rad60);
        explanationLines.push(`- Đáy ${lA}${lB}${lC}${lD} là hình thoi cạnh a = ${a} (góc $\\widehat{BAD} = 60^\\circ$)`);
        break;
      }
      case 'hinh_binh_hanh': {
        const radAngle = Math.PI / 3;
        const dx = b * Math.cos(radAngle);
        const dy = b * Math.sin(radAngle);
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lD] = [dx, dy, 0];
        pts[lC] = [a + dx, dy, 0];
        baseArea = a * dy;
        explanationLines.push(`- Đáy ${lA}${lB}${lC}${lD} là hình bình hành (${lA}${lB} = ${a}, ${lA}${lD} = ${b})`);
        break;
      }
      case 'hinh_thang_vuong': {
        // Hình thang vuông tại A và B: AB=a, BC=a (đáy bé), AD=2a (đáy lớn)
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [a, b, 0];
        pts[lD] = [0, 2 * b, 0];
        baseArea = 0.5 * (b + 2 * b) * a;
        explanationLines.push(`- Đáy ${lA}${lB}${lC}${lD} là hình thang vuông tại ${lA} và ${lB} (đáy lớn ${lA}${lD} = ${2 * b}, đáy nhỏ ${lB}${lC} = ${b}, chiều cao ${lA}${lB} = ${a})`);
        break;
      }
      default: {
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [a, a, 0];
        pts[lD] = [0, a, 0];
        baseArea = a * a;
        explanationLines.push(`- Đáy ${lA}${lB}${lC}${lD} là hình vuông cạnh a = ${a}`);
        break;
      }
    }

    if (draw_base_diagonals) {
      diagonals.push([lA, lC]);
      diagonals.push([lB, lD]);
    }
  }

  // ==========================================
  // 2. TÍNH VỊ TRÍ ĐƯỜNG CAO VÀ ĐỈNH S
  // ==========================================
  const [lA, lB, lC, lD] = baseLabels;
  const isChopDeu = type === 'chop_deu' || height_type === 'chop_deu' || height_type === 'SO_chop_deu';

  if (isChopDeu) {
    // Chóp đều: chân đường cao là tâm đáy O
    if (basePolygonPoints.length === 3) {
      // Trọng tâm tam giác đều
      const ox = (pts[lA][0] + pts[lB][0] + pts[lC][0]) / 3;
      const oy = (pts[lA][1] + pts[lB][1] + pts[lC][1]) / 3;
      foot = { label: 'O', coords: [ox, oy, 0] };
      pts[apexLabel] = [ox, oy, h];
      explanationLines.push(`- Chóp tam giác đều: Tâm đáy O là trọng tâm $\\triangle ${lA}${lB}${lC}$, ${apexLabel}O $\\perp$ (${lA}${lB}${lC}), ${apexLabel}O = ${h}`);
    } else {
      // Giao điểm 2 đường chéo hình vuông / chữ nhật / thoi
      const ox = (pts[lA][0] + pts[lC][0]) / 2;
      const oy = (pts[lA][1] + pts[lC][1]) / 2;
      foot = { label: 'O', coords: [ox, oy, 0] };
      pts[apexLabel] = [ox, oy, h];
      explanationLines.push(`- Chóp tứ giác đều: Tâm đáy O là giao điểm 2 đường chéo, ${apexLabel}O $\\perp$ (${lA}${lB}${lC}${lD}), ${apexLabel}O = ${h}`);
    }
  } else if (height_type === 'SA_vuong_goc_day' || height_type === 'edge_A') {
    foot = { label: lA, coords: [...pts[lA]] };
    pts[apexLabel] = [pts[lA][0], pts[lA][1], h];
    explanationLines.push(`- Cạnh bên ${apexLabel}${lA} $\\perp$ (đáy), chiều cao ${apexLabel}${lA} = ${h}`);
  } else if (height_type === 'SB_vuong_goc_day' || height_type === 'edge_B') {
    foot = { label: lB, coords: [...pts[lB]] };
    pts[apexLabel] = [pts[lB][0], pts[lB][1], h];
    explanationLines.push(`- Cạnh bên ${apexLabel}${lB} $\\perp$ (đáy), chiều cao ${apexLabel}${lB} = ${h}`);
  } else if (height_type === 'SC_vuong_goc_day' || height_type === 'edge_C') {
    foot = { label: lC, coords: [...pts[lC]] };
    pts[apexLabel] = [pts[lC][0], pts[lC][1], h];
    explanationLines.push(`- Cạnh bên ${apexLabel}${lC} $\\perp$ (đáy), chiều cao ${apexLabel}${lC} = ${h}`);
  } else if (height_type === 'SH_trung_diem_AB') {
    // Mặt bên (SAB) vuông góc đáy, tam giác SAB cân/đều => H là trung điểm AB
    const hx = (pts[lA][0] + pts[lB][0]) / 2;
    const hy = (pts[lA][1] + pts[lB][1]) / 2;
    foot = { label: footLabel || 'H', coords: [hx, hy, 0] };
    pts[apexLabel] = [hx, hy, h];
    explanationLines.push(`- Mặt bên (${apexLabel}${lA}${lB}) $\\perp$ (đáy), ${foot.label} là trung điểm ${lA}${lB}, ${apexLabel}${foot.label} $\\perp$ (đáy), ${apexLabel}${foot.label} = ${h}`);
  } else if (height_type === 'SH_trung_diem_AD' && pts[lD]) {
    const hx = (pts[lA][0] + pts[lD][0]) / 2;
    const hy = (pts[lA][1] + pts[lD][1]) / 2;
    foot = { label: footLabel || 'H', coords: [hx, hy, 0] };
    pts[apexLabel] = [hx, hy, h];
    explanationLines.push(`- ${foot.label} là trung điểm ${lA}${lD}, ${apexLabel}${foot.label} $\\perp$ (đáy), ${apexLabel}${foot.label} = ${h}`);
  } else if (height_type === 'SH_trong_tam' && pts[lC]) {
    const hx = (pts[lA][0] + pts[lB][0] + pts[lC][0]) / 3;
    const hy = (pts[lA][1] + pts[lB][1] + pts[lC][1]) / 3;
    foot = { label: footLabel || 'G', coords: [hx, hy, 0] };
    pts[apexLabel] = [hx, hy, h];
    explanationLines.push(`- ${foot.label} là trọng tâm đáy, ${apexLabel}${foot.label} $\\perp$ (đáy), chiều cao = ${h}`);
  } else {
    // Mặc định SA vuông góc đáy
    foot = { label: lA, coords: [...pts[lA]] };
    pts[apexLabel] = [pts[lA][0], pts[lA][1], h];
    explanationLines.push(`- Cạnh bên ${apexLabel}${lA} $\\perp$ (đáy), chiều cao = ${h}`);
  }

  // ==========================================
  // 3. TẠO TẬP LỆNH GEOGEBRA (COMMANDS)
  // ==========================================
  const commands = [];

  // Perspective 3D
  commands.push('SetPerspective("T")');

  // Trục và lưới
  commands.push(`ShowAxes(${show_axes})`);
  commands.push(`ShowGrid(${show_grid})`);

  // Tạo các điểm đỉnh đáy
  for (const label of basePolygonPoints) {
    const [x, y, z] = pts[label];
    commands.push(`${label} = ${ptStr(x, y, z)}`);
    commands.push(`SetPointSize(${label}, 4)`);
    commands.push(`ShowLabel(${label}, true)`);
  }

  // Tạo điểm đỉnh S
  const [sx, sy, sz] = pts[apexLabel];
  commands.push(`${apexLabel} = ${ptStr(sx, sy, sz)}`);
  commands.push(`SetPointSize(${apexLabel}, 5)`);
  commands.push(`SetColor(${apexLabel}, "${height_color}")`);
  commands.push(`ShowLabel(${apexLabel}, true)`);

  // Tạo đa giác đáy
  const basePolyName = 'day';
  commands.push(`${basePolyName} = Polygon(${basePolygonPoints.join(', ')})`);
  commands.push(`SetColor(${basePolyName}, "${color}")`);
  commands.push(`SetFilling(${basePolyName}, 0.15)`);

  // Tạo khối chóp
  const pyramidName = 'chop';
  commands.push(`${pyramidName} = Pyramid(${basePolyName}, ${apexLabel})`);
  commands.push(`SetColor(${pyramidName}, "${color}")`);
  commands.push(`SetFilling(${pyramidName}, ${opacity})`);

  // Chân đường cao H (nếu không trùng với điểm đỉnh đáy đã có)
  const isFootExistingVertex = basePolygonPoints.includes(foot.label);
  if (!isFootExistingVertex && foot) {
    commands.push(`${foot.label} = ${ptStr(foot.coords[0], foot.coords[1], foot.coords[2])}`);
    commands.push(`SetPointSize(${foot.label}, 4)`);
    commands.push(`SetColor(${foot.label}, "${height_color}")`);
    commands.push(`ShowLabel(${foot.label}, true)`);
  }

  // Vẽ đường cao nối S và chân đường cao
  if (draw_height && foot) {
    const heightSegName = `duong_cao_${apexLabel}${foot.label}`;
    commands.push(`${heightSegName} = Segment(${apexLabel}, ${foot.label})`);
    commands.push(`SetColor(${heightSegName}, "${height_color}")`);
    commands.push(`SetLineThickness(${heightSegName}, 3)`);
    // Nếu chân đường cao nằm trong khối chóp hoặc là tâm O, vẽ nét đứt
    if (!isFootExistingVertex) {
      commands.push(`SetLineStyle(${heightSegName}, 1)`); // 1 = dashed
    }
  }

  // Vẽ đường chéo đáy (nếu là tứ giác) nét đứt
  for (let i = 0; i < diagonals.length; i++) {
    const [p1, p2] = diagonals[i];
    const diagName = `cheo_${p1}${p2}`;
    commands.push(`${diagName} = Segment(${p1}, ${p2})`);
    commands.push(`SetLineStyle(${diagName}, 1)`); // dashed
    commands.push(`SetColor(${diagName}, "#64748b")`);
    commands.push(`SetLineThickness(${diagName}, 2)`);
  }

  // Các điểm phụ thêm (extra points: trung điểm, tỉ lệ...)
  if (Array.isArray(extra_points)) {
    for (const ep of extra_points) {
      if (ep.name && ep.midpoint_of && ep.midpoint_of.length === 2) {
        const [p1, p2] = ep.midpoint_of;
        commands.push(`${ep.name} = Midpoint(${p1}, ${p2})`);
        commands.push(`SetPointSize(${ep.name}, 4)`);
        commands.push(`SetColor(${ep.name}, "${ep.color || '#10b981'}")`);
        commands.push(`ShowLabel(${ep.name}, true)`);
        explanationLines.push(`- Điểm phụ: ${ep.name} là trung điểm của ${p1}${p2}`);
      } else if (ep.name && ep.coords) {
        commands.push(`${ep.name} = ${ptStr(ep.coords[0], ep.coords[1], ep.coords[2])}`);
        commands.push(`SetPointSize(${ep.name}, 4)`);
        commands.push(`SetColor(${ep.name}, "${ep.color || '#10b981'}")`);
        commands.push(`ShowLabel(${ep.name}, true)`);
      }
    }
  }

  // Các mặt phẳng hoặc thiết diện bổ sung
  if (Array.isArray(planes)) {
    for (let i = 0; i < planes.length; i++) {
      const pl = planes[i];
      if (pl.points && pl.points.length >= 3) {
        const plName = `mat_phang_${i + 1}`;
        commands.push(`${plName} = Polygon(${pl.points.join(', ')})`);
        commands.push(`SetColor(${plName}, "${pl.color || '#f59e0b'}")`);
        commands.push(`SetFilling(${plName}, ${pl.opacity || 0.35})`);
        explanationLines.push(`- Mặt phẳng/Thiết diện qua: (${pl.points.join(', ')})`);
      }
    }
  }

  // Thể tích
  const volume = (1 / 3) * baseArea * h;
  const volumeFormula = `V = (1/3) * S_đáy * h = (1/3) * ${roundNum(baseArea)} * ${h} ≈ ${roundNum(volume)}`;
  explanationLines.push(`- Diện tích đáy: $S_{đáy} \\approx ${roundNum(baseArea)}$`);
  explanationLines.push(`- Thể tích khối chóp: $${volumeFormula}$`);

  return {
    commands,
    explanation: explanationLines.join('\n'),
    points: pts,
    foot,
    baseArea: roundNum(baseArea),
    height: h,
    volume: roundNum(volume),
    volumeFormula
  };
}

module.exports = {
  buildPyramidCommands,
  ptStr,
  roundNum
};
