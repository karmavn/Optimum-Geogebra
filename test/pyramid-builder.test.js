const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPyramidCommands, roundNum } = require('../src/pyramid-builder.js');

describe('Pyramid Builder Tests', () => {
  it('should build a triangular pyramid with right triangle base at A and SA perp base', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_vuong_A',
      height_type: 'SA_vuong_goc_day',
      dimensions: { a: 4, b: 3, h: 5 }
    });

    assert.equal(res.baseArea, 6);
    assert.equal(res.height, 5);
    assert.equal(res.volume, 10);
    assert.deepEqual(res.points.A, [0, 0, 0]);
    assert.deepEqual(res.points.B, [4, 0, 0]);
    assert.deepEqual(res.points.C, [0, 3, 0]);
    assert.deepEqual(res.points.S, [0, 0, 5]);
    assert.equal(res.foot.label, 'A');
    assert.ok(res.commands.includes('chop = Pyramid(day, S)'));
    assert.ok(res.commands.includes('day = Polygon(A, B, C)'));
  });

  it('should build a regular triangular pyramid (chóp tam giác đều)', () => {
    const res = buildPyramidCommands({
      type: 'chop_deu',
      base_shape: 'tam_giac_deu',
      dimensions: { a: 6, h: 4 }
    });

    assert.ok(res.baseArea > 0);
    assert.equal(res.foot.label, 'O');
    assert.equal(res.points.S[2], 4);
    assert.ok(res.commands.some(cmd => cmd.includes('SetLineStyle') && cmd.includes('1')));
  });

  it('should default omitted base_shape for type chop_deu to tam_giac_deu', () => {
    const res = buildPyramidCommands({
      type: 'chop_deu',
      dimensions: { a: 6, h: 4 }
    });

    assert.equal(res.baseArea, roundNum((36 * Math.sqrt(3)) / 4));
    assert.ok(res.explanation.includes('Chóp tam giác đều'));
  });

  it('should build a quadrangular pyramid with square base (chóp tứ giác đều)', () => {
    const res = buildPyramidCommands({
      type: 'chop_deu',
      base_shape: 'hinh_vuong',
      dimensions: { a: 4, h: 6 },
      extra_points: [{ name: 'M', midpoint_of: ['S', 'C'] }]
    });

    assert.equal(res.baseArea, 16);
    assert.equal(res.volume, 32);
    assert.deepEqual(res.foot.coords, [2, 2, 0]);
    assert.deepEqual(res.points.S, [2, 2, 6]);
    assert.ok(res.commands.includes('M = Midpoint(S, C)'));
    assert.ok(res.commands.some(cmd => cmd.includes('cheo_AC')));
    assert.ok(res.commands.some(cmd => cmd.includes('cheo_BD')));
  });

  it('should build a quadrangular pyramid with right trapezoid base (hình thang vuông)', () => {
    const res = buildPyramidCommands({
      type: 'tu_giac',
      base_shape: 'hinh_thang_vuong',
      height_type: 'SA_vuong_goc_day',
      dimensions: { a: 4, b: 3, h: 5 }
    });

    assert.equal(res.points.A[0], 0);
    assert.equal(res.points.D[1], 6); // 2 * b
    assert.equal(res.volume, 30);
  });

  it('should handle isosceles triangle edge case where side b is small defensively', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_can',
      dimensions: { a: 6, b: 2, h: 4 }
    });

    assert.ok(!isNaN(res.points.A[1]));
    assert.ok(!isNaN(res.volume));
    assert.ok(res.volume > 0);
  });

  it('should support side face perpendicular to base with midpoint H', () => {
    const res = buildPyramidCommands({
      type: 'tu_giac',
      base_shape: 'hinh_chu_nhat',
      height_type: 'SH_trung_diem_AB',
      dimensions: { a: 4, b: 6, h: 5 }
    });

    assert.deepEqual(res.foot.coords, [2, 0, 0]);
    assert.deepEqual(res.points.S, [2, 0, 5]);
  });

  it('should correctly support SC_vuong_goc_day with foot at C', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_vuong_A',
      height_type: 'SC_vuong_goc_day',
      dimensions: { a: 4, b: 3, h: 5 }
    });

    assert.equal(res.foot.label, 'C');
    assert.deepEqual(res.foot.coords, [0, 3, 0]);
    assert.deepEqual(res.points.S, [0, 3, 5]);
    assert.ok(res.explanation.includes('SC'));
  });

  it('should fallback dimension leg b in tam_giac_vuong_B when c is omitted', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_vuong_B',
      dimensions: { a: 4, b: 3, h: 5 }
    });

    assert.deepEqual(res.points.B, [0, 0, 0]);
    assert.deepEqual(res.points.A, [0, 4, 0]);
    assert.deepEqual(res.points.C, [3, 0, 0]);
    assert.equal(res.baseArea, 6);
  });

  it('should assign default foot label G for SH_trong_tam on triangle', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_deu',
      height_type: 'SH_trong_tam',
      dimensions: { a: 6, h: 5 }
    });

    assert.equal(res.foot.label, 'G');
    assert.ok(res.commands.some(cmd => cmd.includes('duong_cao_SG')));
  });

  it('should compute true 4-vertex centroid for SH_trong_tam on quadrilateral', () => {
    const res = buildPyramidCommands({
      type: 'tu_giac',
      base_shape: 'hinh_chu_nhat',
      height_type: 'SH_trong_tam',
      dimensions: { a: 4, b: 6, h: 5 }
    });

    assert.deepEqual(res.foot.coords, [2, 3, 0]);
    assert.deepEqual(res.points.S, [2, 3, 5]);
  });

  it('should compute exact AC/BD diagonal intersection for hinh_thang_vuong with SO_chop_deu', () => {
    const res = buildPyramidCommands({
      type: 'tu_giac',
      base_shape: 'hinh_thang_vuong',
      height_type: 'SO_chop_deu',
      dimensions: { a: 6, b: 3, h: 5 }
    });

    // A=(0,0), B=(6,0), C=(6,3), D=(0,6) -> AC & BD intersect at (2a/3, 2b/3) = (4, 2)
    assert.deepEqual(res.foot.coords, [4, 2, 0]);
    assert.deepEqual(res.points.S, [4, 2, 5]);
    assert.ok(!res.explanation.includes('Chóp tứ giác đều'));
  });

  it('should honor custom labels.height_foot in chop_deu / SO_chop_deu', () => {
    const res = buildPyramidCommands({
      type: 'chop_deu',
      base_shape: 'hinh_vuong',
      labels: { height_foot: 'I' },
      dimensions: { a: 4, h: 5 }
    });

    assert.equal(res.foot.label, 'I');
    assert.ok(res.commands.some(cmd => cmd.startsWith('I = (2, 2, 0)')));
  });

  it('should support primed labels without invalid mid-identifier quotes and avoid foot collisions', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_vuong_A',
      height_type: 'SH_trung_diem_AB',
      labels: { apex: "S'", base: ["A'", "B'", "C'"], height_foot: "H'" },
      dimensions: { a: 4, b: 3, h: 5 }
    });

    assert.ok(res.commands.some(cmd => cmd.startsWith("S' = ")));
    assert.ok(res.commands.some(cmd => cmd.includes("duong_cao_SpHp = Segment(S', H')")));

    const resCollision = buildPyramidCommands({
      type: 'chop_deu',
      base_shape: 'tam_giac_deu',
      labels: { apex: 'S', base: ['O', 'B', 'C'] },
      dimensions: { a: 6, h: 4 }
    });
    assert.equal(resCollision.foot.label, 'O_1');
  });

  it('should support scalene triangle base and reject impossible triangle inequality', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_thuong',
      dimensions: { a: 5, b: 4, c: 6, h: 5 }
    });

    assert.ok(res.baseArea > 0);
    assert.equal(res.points.B[0], 6);
    assert.ok(res.explanation.includes('tam giác thường'));

    assert.throws(
      () => buildPyramidCommands({
        type: 'tam_giac',
        base_shape: 'tam_giac_thuong',
        dimensions: { a: 1, b: 1, c: 10, h: 5 }
      }),
      (err) => err.statusCode === 400
    );
  });

  it('should reject command injection, invalid labels/colors, negative dims, and mismatched shapes', () => {
    const invalidInputs = [
      { labels: { apex: 'S"); Execute({}); //' } },
      { color: 'red"); Execute({}); //' },
      { labels: { base: ['A', 'B'] } },
      { labels: { base: ['A', 'A', 'C'] } },
      { labels: { apex: 'A', base: ['A', 'B', 'C'] } },
      { dimensions: { a: -4, b: 3, h: 5 } },
      { dimensions: { a: 4, b: 3, h: 0 } },
      { dimensions: { a: Number.NaN } },
      { type: 'custom', base_shape: 'tam_giac_vuong_A' },
      { type: 'chop_deu', base_shape: 'tam_giac_vuong_A' },
      { type: 'tam_giac', base_shape: 'hinh_vuong' },
      { type: 'tam_giac', base_shape: 'tam_giac_deu', height_type: 'SH_trung_diem_AD' },
      { opacity: 1.5 },
      { extra_points: [{ name: 'M', coords: [1, 2] }] }
    ];

    for (const bad of invalidInputs) {
      assert.throws(
        () => buildPyramidCommands(bad),
        (err) => err.statusCode === 400,
        `Expected 400 validation error for ${JSON.stringify(bad)}`
      );
    }
  });

  it('should respect explicit opacity 0, omit SetPerspective("T"), and round output coordinates', () => {
    const res = buildPyramidCommands({
      type: 'tam_giac',
      base_shape: 'tam_giac_deu',
      dimensions: { a: 5, h: 4 },
      opacity: 0,
      planes: [{ points: ['A', 'B', 'S'], opacity: 0 }]
    });

    assert.ok(res.commands.includes('SetFilling(chop, 0)'));
    assert.ok(res.commands.includes('SetFilling(mat_phang_1, 0)'));
    assert.ok(!res.commands.includes('SetPerspective("T")'));
    // C[1] for equilateral side 5 is 5 * sqrt(3) / 2 = 4.330127... -> rounded to 4.33
    assert.equal(res.points.C[1], 4.33);
  });
});
