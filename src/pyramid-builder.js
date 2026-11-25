/**
 * Pyramid Builder for GeoGebra 3D
 * Generates GeoGebra commands for 3D pyramids (hình chóp)
 * Tailored for Vietnamese High School Geometry (Toán 11, 12, ĐGNL, THPT QG)
 */

const VALID_LABEL_RE = /^[A-Za-z][A-Za-z0-9_]*'*$/;
const VALID_COLOR_RE = /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]{3,20})$/;

const TRIANGLE_SHAPES = new Set([
  'tam_giac_vuong_A',
  'tam_giac_vuong_B',
  'tam_giac_vuong_C',
  'tam_giac_deu',
  'tam_giac_can',
  'tam_giac_thuong'
]);

const QUAD_SHAPES = new Set([
  'hinh_vuong',
  'hinh_chu_nhat',
  'hinh_thoi',
  'hinh_binh_hanh',
  'hinh_thang_vuong'
]);

const VALID_TYPES = new Set(['tam_giac', 'tu_giac', 'chop_deu']);

const VALID_HEIGHT_TYPES = new Set([
  'SA_vuong_goc_day', 'edge_A',
  'SB_vuong_goc_day', 'edge_B',
  'SC_vuong_goc_day', 'edge_C',
  'chop_deu', 'SO_chop_deu',
  'SH_trung_diem_AB',
  'SH_trung_diem_AD',
  'SH_trong_tam'
]);

function createValidationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function roundNum(n) {
  return Math.round(n * 1000) / 1000;
}

function ptStr(x, y, z) {
  return `(${roundNum(x)}, ${roundNum(y)}, ${roundNum(z)})`;
}

function validateLabel(val, fieldName) {
  if (typeof val !== 'string' || val.length === 0 || val.length > 20 || !VALID_LABEL_RE.test(val)) {
    throw createValidationError(`Invalid GeoGebra point label for ${fieldName}: ${JSON.stringify(val)}`);
  }
  return val;
}

function validateColor(val, fieldName) {
  if (typeof val !== 'string' || !VALID_COLOR_RE.test(val)) {
    throw createValidationError(`Invalid color for ${fieldName}: ${JSON.stringify(val)}`);
  }
  return val;
}

function parsePositiveDim(val, defaultVal, fieldName) {
  if (val === undefined) return defaultVal;
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) {
    throw createValidationError(`Dimension ${fieldName} must be a positive finite number`);
  }
  return num;
}

function validateOpacity(val, defaultVal, fieldName) {
  if (val === undefined) return defaultVal;
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    throw createValidationError(`Opacity ${fieldName} must be between 0 and 1`);
  }
  return num;
}

function safeGgbIdPart(label) {
  return label.replace(/'/g, 'p');
}

function resolveFootLabel(defaultLabel, explicitFootLabel, occupiedSet) {
  if (explicitFootLabel !== undefined) {
    const validated = validateLabel(explicitFootLabel, 'labels.height_foot');
    if (occupiedSet.has(validated)) {
      throw createValidationError(`labels.height_foot (${validated}) collides with an existing vertex label`);
    }
    return validated;
  }
  if (!occupiedSet.has(defaultLabel)) return defaultLabel;
  let idx = 1;
  while (occupiedSet.has(`${defaultLabel}_${idx}`)) {
    idx += 1;
  }
  return `${defaultLabel}_${idx}`;
}

function intersect2D(p1, p2, p3, p4) {
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1];
  const x4 = p4[0], y4 = p4[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) {
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }
  const det1 = x1 * y2 - y1 * x2;
  const det2 = x3 * y4 - y3 * x4;
  const ix = (det1 * (x3 - x4) - (x1 - x2) * det2) / denom;
  const iy = (det1 * (y3 - y4) - (y1 - y2) * det2) / denom;
  return [ix, iy];
}

function resolveConfiguration(options) {
  const type = options.type || 'tam_giac';
  if (!VALID_TYPES.has(type)) {
    throw createValidationError(`Unsupported pyramid type: ${type}`);
  }

  let baseShape = options.base_shape;
  if (!baseShape) {
    baseShape = type === 'tu_giac' ? 'hinh_vuong' : (type === 'chop_deu' ? 'tam_giac_deu' : 'tam_giac_vuong_A');
  }

  const isTriShape = TRIANGLE_SHAPES.has(baseShape);
  const isQuadShape = QUAD_SHAPES.has(baseShape);
  if (!isTriShape && !isQuadShape) {
    throw createValidationError(`Unsupported base_shape: ${baseShape}`);
  }
  if (type === 'tam_giac' && !isTriShape) {
    throw createValidationError(`base_shape ${baseShape} is incompatible with type 'tam_giac'`);
  }
  if (type === 'tu_giac' && !isQuadShape) {
    throw createValidationError(`base_shape ${baseShape} is incompatible with type 'tu_giac'`);
  }
  if (type === 'chop_deu' && baseShape !== 'tam_giac_deu' && baseShape !== 'hinh_vuong') {
    throw createValidationError(`Regular pyramid (chop_deu) requires 'tam_giac_deu' or 'hinh_vuong', got ${baseShape}`);
  }

  const heightType = options.height_type || (type === 'chop_deu' ? 'SO_chop_deu' : 'SA_vuong_goc_day');
  if (!VALID_HEIGHT_TYPES.has(heightType)) {
    throw createValidationError(`Unsupported height_type: ${heightType}`);
  }
  if (heightType === 'SH_trung_diem_AD' && isTriShape) {
    throw createValidationError(`height_type 'SH_trung_diem_AD' requires a quadrilateral base`);
  }

  return { type, baseShape, heightType, isTriShape };
}

/**
 * Builds GeoGebra commands to draw a 3D pyramid
 * @param {Object} options
 * @returns {{ commands: string[], explanation: string, points: Object, foot: Object, baseArea: number, height: number, volume: number, volumeFormula: string }}
 */
function buildPyramidCommands(options = {}) {
  if (!options || typeof options !== 'object') {
    throw createValidationError('Pyramid options must be an object');
  }

  const {
    dimensions = {},
    labels = {},
    draw_height = true,
    draw_base_diagonals = true,
    opacity: rawOpacity,
    color: rawColor = '#2563eb',
    height_color: rawHeightColor = '#dc2626',
    extra_points = [],
    planes = [],
    show_axes = false,
    show_grid = false
  } = options;

  const { type, baseShape, heightType, isTriShape } = resolveConfiguration(options);

  const a = parsePositiveDim(dimensions.a, 4, 'a');
  const b = parsePositiveDim(dimensions.b, 3, 'b');
  const h = parsePositiveDim(dimensions.h, 5, 'h');
  const opacity = validateOpacity(rawOpacity, 0.25, 'opacity');
  const color = validateColor(rawColor, 'color');
  const heightColor = validateColor(rawHeightColor, 'height_color');

  const apexLabel = validateLabel(labels.apex !== undefined ? labels.apex : 'S', 'labels.apex');
  const expectedBaseLen = isTriShape ? 3 : 4;
  const rawBaseLabels = labels.base !== undefined
    ? labels.base
    : (isTriShape ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D']);

  if (!Array.isArray(rawBaseLabels) || rawBaseLabels.length !== expectedBaseLen) {
    throw createValidationError(`labels.base must have exactly ${expectedBaseLen} labels for ${baseShape}`);
  }
  const baseLabels = rawBaseLabels.map((lbl, idx) => validateLabel(lbl, `labels.base[${idx}]`));
  const occupiedLabels = new Set(baseLabels);
  if (occupiedLabels.size !== expectedBaseLen) {
    throw createValidationError('labels.base contains duplicate vertex labels');
  }
  if (occupiedLabels.has(apexLabel)) {
    throw createValidationError(`labels.apex (${apexLabel}) cannot collide with a base vertex label`);
  }
  occupiedLabels.add(apexLabel);

  const pts = {};
  let foot = null;
  const explanationLines = [];
  const basePolygonPoints = [...baseLabels];
  const diagonals = [];
  let baseArea = 0;

  // ==========================================
  // 1. TÍNH TỌA ĐỘ ĐÁY
  // ==========================================
  if (isTriShape) {
    const [lA, lB, lC] = baseLabels;
    switch (baseShape) {
      case 'tam_giac_deu': {
        const hEq = (a * Math.sqrt(3)) / 2;
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [a / 2, hEq, 0];
        baseArea = (a * a * Math.sqrt(3)) / 4;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác đều cạnh a = ${a}`);
        break;
      }
      case 'tam_giac_vuong_B': {
        const sideBC = dimensions.c !== undefined
          ? parsePositiveDim(dimensions.c, 4, 'c')
          : (dimensions.b !== undefined ? b : 4);
        pts[lB] = [0, 0, 0];
        pts[lA] = [0, a, 0];
        pts[lC] = [sideBC, 0, 0];
        baseArea = 0.5 * a * sideBC;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác vuông tại ${lB} (cạnh ${lB}${lA} = ${a}, ${lB}${lC} = ${sideBC})`);
        break;
      }
      case 'tam_giac_vuong_C': {
        pts[lC] = [0, 0, 0];
        pts[lA] = [b, 0, 0];
        pts[lB] = [0, a, 0];
        baseArea = 0.5 * a * b;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác vuông tại ${lC} (cạnh ${lC}${lA} = ${b}, ${lC}${lB} = ${a})`);
        break;
      }
      case 'tam_giac_can': {
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
        const sideC = dimensions.c !== undefined
          ? parsePositiveDim(dimensions.c, 4, 'c')
          : Math.sqrt(a * a + b * b - a * b);
        if (a + b <= sideC || a + sideC <= b || b + sideC <= a) {
          throw createValidationError(`Invalid triangle side lengths (a=${a}, b=${b}, c=${roundNum(sideC)}): violates triangle inequality`);
        }
        const cosA = (b * b + sideC * sideC - a * a) / (2 * b * sideC);
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        pts[lA] = [0, 0, 0];
        pts[lB] = [sideC, 0, 0];
        pts[lC] = [b * cosA, b * sinA, 0];
        baseArea = 0.5 * sideC * b * sinA;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác thường (cạnh đáy ${lA}${lB} = ${roundNum(sideC)}, cạnh ${lA}${lC} = ${b})`);
        break;
      }
      case 'tam_giac_vuong_A':
      default: {
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [0, b, 0];
        baseArea = 0.5 * a * b;
        explanationLines.push(`- Đáy ${lA}${lB}${lC} là tam giác vuông tại ${lA} (cạnh ${lA}${lB} = ${a}, ${lA}${lC} = ${b})`);
        break;
      }
    }
  } else {
    const [lA, lB, lC, lD] = baseLabels;
    switch (baseShape) {
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
        // Hình thang vuông tại A và B: AB = a, BC = b (đáy bé), AD = 2b (đáy lớn)
        pts[lA] = [0, 0, 0];
        pts[lB] = [a, 0, 0];
        pts[lC] = [a, b, 0];
        pts[lD] = [0, 2 * b, 0];
        baseArea = 0.5 * (b + 2 * b) * a;
        explanationLines.push(`- Đáy ${lA}${lB}${lC}${lD} là hình thang vuông tại ${lA} và ${lB} (đáy lớn ${lA}${lD} = ${2 * b}, đáy nhỏ ${lB}${lC} = ${b}, chiều cao ${lA}${lB} = ${a})`);
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
  const isChopDeu = type === 'chop_deu' || heightType === 'chop_deu' || heightType === 'SO_chop_deu';

  if (isChopDeu) {
    const resolvedFoot = resolveFootLabel('O', labels.height_foot, occupiedLabels);
    if (basePolygonPoints.length === 3) {
      const ox = (pts[lA][0] + pts[lB][0] + pts[lC][0]) / 3;
      const oy = (pts[lA][1] + pts[lB][1] + pts[lC][1]) / 3;
      foot = { label: resolvedFoot, coords: [ox, oy, 0] };
      pts[apexLabel] = [ox, oy, h];
      const prefix = baseShape === 'tam_giac_deu' ? 'Chóp tam giác đều' : 'Chóp có chân đường cao tại trọng tâm đáy';
      explanationLines.push(`- ${prefix}: Tâm đáy ${resolvedFoot} là trọng tâm $\\triangle ${lA}${lB}${lC}$, ${apexLabel}${resolvedFoot} $\\perp$ (${lA}${lB}${lC}), ${apexLabel}${resolvedFoot} = ${h}`);
    } else {
      const [ox, oy] = intersect2D(pts[lA], pts[lC], pts[lB], pts[lD]);
      foot = { label: resolvedFoot, coords: [ox, oy, 0] };
      pts[apexLabel] = [ox, oy, h];
      const prefix = baseShape === 'hinh_vuong' ? 'Chóp tứ giác đều' : 'Chóp có chân đường cao tại giao điểm 2 đường chéo';
      explanationLines.push(`- ${prefix}: ${resolvedFoot} là giao điểm 2 đường chéo ${lA}${lC} và ${lB}${lD}, ${apexLabel}${resolvedFoot} $\\perp$ (${lA}${lB}${lC}${lD}), ${apexLabel}${resolvedFoot} = ${h}`);
    }
  } else if (heightType === 'SA_vuong_goc_day' || heightType === 'edge_A') {
    foot = { label: lA, coords: [...pts[lA]] };
    pts[apexLabel] = [pts[lA][0], pts[lA][1], h];
    explanationLines.push(`- Cạnh bên ${apexLabel}${lA} $\\perp$ (đáy), chiều cao ${apexLabel}${lA} = ${h}`);
  } else if (heightType === 'SB_vuong_goc_day' || heightType === 'edge_B') {
    foot = { label: lB, coords: [...pts[lB]] };
    pts[apexLabel] = [pts[lB][0], pts[lB][1], h];
    explanationLines.push(`- Cạnh bên ${apexLabel}${lB} $\\perp$ (đáy), chiều cao ${apexLabel}${lB} = ${h}`);
  } else if (heightType === 'SC_vuong_goc_day' || heightType === 'edge_C') {
    foot = { label: lC, coords: [...pts[lC]] };
    pts[apexLabel] = [pts[lC][0], pts[lC][1], h];
    explanationLines.push(`- Cạnh bên ${apexLabel}${lC} $\\perp$ (đáy), chiều cao ${apexLabel}${lC} = ${h}`);
  } else if (heightType === 'SH_trung_diem_AB') {
    const resolvedFoot = resolveFootLabel('H', labels.height_foot, occupiedLabels);
    const hx = (pts[lA][0] + pts[lB][0]) / 2;
    const hy = (pts[lA][1] + pts[lB][1]) / 2;
    foot = { label: resolvedFoot, coords: [hx, hy, 0] };
    pts[apexLabel] = [hx, hy, h];
    explanationLines.push(`- Mặt bên (${apexLabel}${lA}${lB}) $\\perp$ (đáy), ${foot.label} là trung điểm ${lA}${lB}, ${apexLabel}${foot.label} $\\perp$ (đáy), ${apexLabel}${foot.label} = ${h}`);
  } else if (heightType === 'SH_trung_diem_AD') {
    const resolvedFoot = resolveFootLabel('H', labels.height_foot, occupiedLabels);
    const hx = (pts[lA][0] + pts[lD][0]) / 2;
    const hy = (pts[lA][1] + pts[lD][1]) / 2;
    foot = { label: resolvedFoot, coords: [hx, hy, 0] };
    pts[apexLabel] = [hx, hy, h];
    explanationLines.push(`- Mặt bên (${apexLabel}${lA}${lD}) $\\perp$ (đáy), ${foot.label} là trung điểm ${lA}${lD}, ${apexLabel}${foot.label} $\\perp$ (đáy), ${apexLabel}${foot.label} = ${h}`);
  } else if (heightType === 'SH_trong_tam') {
    const resolvedFoot = resolveFootLabel('G', labels.height_foot, occupiedLabels);
    const n = basePolygonPoints.length;
    let sumX = 0;
    let sumY = 0;
    for (const v of basePolygonPoints) {
      sumX += pts[v][0];
      sumY += pts[v][1];
    }
    const hx = sumX / n;
    const hy = sumY / n;
    foot = { label: resolvedFoot, coords: [hx, hy, 0] };
    pts[apexLabel] = [hx, hy, h];
    explanationLines.push(`- ${foot.label} là trọng tâm đáy, ${apexLabel}${foot.label} $\\perp$ (đáy), chiều cao = ${h}`);
  }

  // ==========================================
  // 3. TẠO TẬP LỆNH GEOGEBRA (COMMANDS)
  // ==========================================
  const commands = [];

  commands.push(`ShowAxes(${Boolean(show_axes)})`);
  commands.push(`ShowGrid(${Boolean(show_grid)})`);

  for (const label of basePolygonPoints) {
    const [x, y, z] = pts[label];
    commands.push(`${label} = ${ptStr(x, y, z)}`);
    commands.push(`SetPointSize(${label}, 4)`);
    commands.push(`ShowLabel(${label}, true)`);
  }

  const [sx, sy, sz] = pts[apexLabel];
  commands.push(`${apexLabel} = ${ptStr(sx, sy, sz)}`);
  commands.push(`SetPointSize(${apexLabel}, 5)`);
  commands.push(`SetColor(${apexLabel}, "${heightColor}")`);
  commands.push(`ShowLabel(${apexLabel}, true)`);

  const basePolyName = 'day';
  commands.push(`${basePolyName} = Polygon(${basePolygonPoints.join(', ')})`);
  commands.push(`SetColor(${basePolyName}, "${color}")`);
  commands.push(`SetFilling(${basePolyName}, 0.15)`);

  const pyramidName = 'chop';
  commands.push(`${pyramidName} = Pyramid(${basePolyName}, ${apexLabel})`);
  commands.push(`SetColor(${pyramidName}, "${color}")`);
  commands.push(`SetFilling(${pyramidName}, ${opacity})`);

  const isFootExistingVertex = basePolygonPoints.includes(foot.label);
  if (!isFootExistingVertex && foot) {
    commands.push(`${foot.label} = ${ptStr(foot.coords[0], foot.coords[1], foot.coords[2])}`);
    commands.push(`SetPointSize(${foot.label}, 4)`);
    commands.push(`SetColor(${foot.label}, "${heightColor}")`);
    commands.push(`ShowLabel(${foot.label}, true)`);
  }

  if (draw_height && foot) {
    const heightSegName = `duong_cao_${safeGgbIdPart(apexLabel)}${safeGgbIdPart(foot.label)}`;
    commands.push(`${heightSegName} = Segment(${apexLabel}, ${foot.label})`);
    commands.push(`SetColor(${heightSegName}, "${heightColor}")`);
    commands.push(`SetLineThickness(${heightSegName}, 3)`);
    if (!isFootExistingVertex) {
      commands.push(`SetLineStyle(${heightSegName}, 1)`);
    }
  }

  for (let i = 0; i < diagonals.length; i++) {
    const [p1, p2] = diagonals[i];
    const diagName = `cheo_${safeGgbIdPart(p1)}${safeGgbIdPart(p2)}`;
    commands.push(`${diagName} = Segment(${p1}, ${p2})`);
    commands.push(`SetLineStyle(${diagName}, 1)`);
    commands.push(`SetColor(${diagName}, "#64748b")`);
    commands.push(`SetLineThickness(${diagName}, 2)`);
  }

  if (Array.isArray(extra_points)) {
    for (let i = 0; i < extra_points.length; i++) {
      const ep = extra_points[i];
      if (!ep || typeof ep !== 'object') {
        throw createValidationError(`extra_points[${i}] must be an object`);
      }
      const epName = validateLabel(ep.name, `extra_points[${i}].name`);
      const epColor = validateColor(ep.color !== undefined ? ep.color : '#10b981', `extra_points[${i}].color`);

      if (ep.midpoint_of !== undefined) {
        if (!Array.isArray(ep.midpoint_of) || ep.midpoint_of.length !== 2) {
          throw createValidationError(`extra_points[${i}].midpoint_of must have 2 point labels`);
        }
        const p1 = validateLabel(ep.midpoint_of[0], `extra_points[${i}].midpoint_of[0]`);
        const p2 = validateLabel(ep.midpoint_of[1], `extra_points[${i}].midpoint_of[1]`);
        commands.push(`${epName} = Midpoint(${p1}, ${p2})`);
        commands.push(`SetPointSize(${epName}, 4)`);
        commands.push(`SetColor(${epName}, "${epColor}")`);
        commands.push(`ShowLabel(${epName}, true)`);
        explanationLines.push(`- Điểm phụ: ${epName} là trung điểm của ${p1}${p2}`);
      } else if (ep.coords !== undefined) {
        if (!Array.isArray(ep.coords) || ep.coords.length !== 3 || !ep.coords.every(Number.isFinite)) {
          throw createValidationError(`extra_points[${i}].coords must be [x, y, z] finite numbers`);
        }
        commands.push(`${epName} = ${ptStr(ep.coords[0], ep.coords[1], ep.coords[2])}`);
        commands.push(`SetPointSize(${epName}, 4)`);
        commands.push(`SetColor(${epName}, "${epColor}")`);
        commands.push(`ShowLabel(${epName}, true)`);
      } else {
        throw createValidationError(`extra_points[${i}] must specify midpoint_of or coords`);
      }
    }
  }

  if (Array.isArray(planes)) {
    for (let i = 0; i < planes.length; i++) {
      const pl = planes[i];
      if (!pl || typeof pl !== 'object' || !Array.isArray(pl.points) || pl.points.length < 3) {
        throw createValidationError(`planes[${i}].points must contain at least 3 valid point labels`);
      }
      const plPoints = pl.points.map((pt, j) => validateLabel(pt, `planes[${i}].points[${j}]`));
      const plColor = validateColor(pl.color !== undefined ? pl.color : '#f59e0b', `planes[${i}].color`);
      const plOpacity = validateOpacity(pl.opacity, 0.35, `planes[${i}].opacity`);
      const plName = `mat_phang_${i + 1}`;
      commands.push(`${plName} = Polygon(${plPoints.join(', ')})`);
      commands.push(`SetColor(${plName}, "${plColor}")`);
      commands.push(`SetFilling(${plName}, ${plOpacity})`);
      explanationLines.push(`- Mặt phẳng/Thiết diện qua: (${plPoints.join(', ')})`);
    }
  }

  const volume = (1 / 3) * baseArea * h;
  const volumeFormula = `V = (1/3) * S_đáy * h = (1/3) * ${roundNum(baseArea)} * ${h} ≈ ${roundNum(volume)}`;
  explanationLines.push(`- Diện tích đáy: $S_{đáy} \\approx ${roundNum(baseArea)}$`);
  explanationLines.push(`- Thể tích khối chóp: $${volumeFormula}$`);

  const roundedPoints = {};
  for (const [k, coords] of Object.entries(pts)) {
    roundedPoints[k] = coords.map(roundNum);
  }
  const roundedFoot = foot
    ? { label: foot.label, coords: foot.coords.map(roundNum) }
    : null;

  return {
    commands,
    explanation: explanationLines.join('\n'),
    points: roundedPoints,
    foot: roundedFoot,
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
