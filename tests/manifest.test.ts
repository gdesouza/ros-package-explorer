import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/core/manifest';

const ctx = { id: 'a/package.xml', manifestPath: '/ws/a/package.xml', packageDir: '/ws/a', relativeDir: 'a', ignoredByCatkin: false };

const base = (format: string, body: string) =>
  `<?xml version="1.0"?><package ${format}><name>pkg_a</name><version>1.2.3</version>` +
  `<description>Does <b>things</b>.</description><maintainer email="m@x.org">Maint</maintainer>` +
  `<license>BSD</license>${body}</package>`;

describe('parseManifest', () => {
  it('treats a missing format attribute as format 1 and uses format-1 dependency semantics', () => {
    const r = parseManifest(
      base('', '<buildtool_depend>catkin</buildtool_depend><build_depend>roscpp</build_depend><run_depend version_gte="1.0">std_msgs</run_depend><test_depend>rostest</test_depend>'),
      ctx,
    );
    expect(r.format).toBe(1);
    expect(r.status).toBe('ok');
    expect(r.deps.map((d) => [d.tag, d.categories])).toEqual([
      ['buildtool_depend', ['buildtool']],
      ['build_depend', ['build']],
      ['run_depend', ['runtime']],
      ['test_depend', ['test']],
    ]);
    expect(r.deps[2].constraints).toEqual({ version_gte: '1.0' });
    expect(r.description).toBe('Does things.');
  });

  it('expands format-2 <depend> into build, export and runtime and flags format-1 tags', () => {
    const r = parseManifest(
      base('format="2"', '<depend>roscpp</depend><buildtool_export_depend>catkin</buildtool_export_depend><run_depend>x</run_depend><export><build_type>catkin</build_type><custom a="1"/></export>'),
      ctx,
    );
    expect(r.deps[0].categories).toEqual(['build', 'export', 'runtime']);
    expect(r.deps[1].categories).toEqual(['buildtool', 'export']);
    expect(r.deps.some((d) => d.tag === 'run_depend')).toBe(false);
    expect(r.unknownElements.map((n) => n.tag)).toContain('run_depend');
    expect(r.buildType).toBe('catkin');
    expect(r.exportElements.map((n) => n.tag)).toEqual(['build_type', 'custom']);
    expect(r.status).toBe('warning');
  });

  it('keeps format-3 conditions unevaluated and separates groups', () => {
    const r = parseManifest(
      base('format="3"', '<depend condition="$ROS_VERSION == 1">roscpp</depend><depend>rclcpp</depend><group_depend>nav_group</group_depend><member_of_group>drivers</member_of_group>'),
      ctx,
    );
    expect(r.deps[0]).toMatchObject({ name: 'roscpp', condition: '$ROS_VERSION == 1', evaluation: 'not-evaluated' });
    expect(r.deps[1].evaluation).toBe('unconditional');
    expect(r.deps[2]).toMatchObject({ kind: 'group-depend', name: 'nav_group' });
    expect(r.memberOfGroups).toEqual(['drivers']);
    expect(r.deps.some((d) => d.name === 'drivers')).toBe(false);
  });

  it('does not treat group elements as dependencies before format 3', () => {
    const r = parseManifest(base('format="2"', '<group_depend>g</group_depend><member_of_group>g</member_of_group>'), ctx);
    expect(r.deps).toHaveLength(0);
    expect(r.memberOfGroups).toHaveLength(0);
    expect(r.unknownElements).toHaveLength(2);
  });

  it('preserves repeated fields', () => {
    const r = parseManifest(
      base('format="3"', '<maintainer email="b@x.org">B</maintainer><author email="a@x.org">A</author><author>A2</author><license>MIT</license><url type="repository">https://r</url><url>https://w</url>'),
      ctx,
    );
    expect(r.maintainers).toHaveLength(2);
    expect(r.authors).toHaveLength(2);
    expect(r.licenses.map((l) => l.value)).toEqual(['BSD', 'MIT']);
    expect(r.urls).toEqual([{ url: 'https://r', type: 'repository' }, { url: 'https://w', type: undefined }]);
  });

  it('reports missing required metadata as invalid without inventing values', () => {
    const r = parseManifest('<package format="2"><name>x</name></package>', ctx);
    expect(r.status).toBe('invalid');
    expect(r.version).toBeUndefined();
    expect(r.description).toBeUndefined();
    expect(r.diagnostics.filter((d) => d.severity === 'error' && d.category === 'validation').length).toBeGreaterThanOrEqual(4);
    expect(r.indexed).toBe(true);
  });

  it('keeps malformed XML visible, unindexed, with a parse diagnostic and fallback label', () => {
    const r = parseManifest('<package><name>x</package>', ctx);
    expect(r.status).toBe('invalid');
    expect(r.indexed).toBe(false);
    expect(r.label).toBe('a');
    expect(r.diagnostics[0].category).toBe('parse');
  });

  it('marks unsupported formats', () => {
    const r = parseManifest('<package format="9"><name>x</name></package>', ctx);
    expect(r.status).toBe('unsupported');
    expect(r.indexed).toBe(false);
  });

  it('rejects a wrong root element', () => {
    expect(parseManifest('<robot/>', ctx).status).toBe('invalid');
  });

  it('never expands entities declared in a DOCTYPE', () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE package [<!ENTITY xxe SYSTEM "file:///etc/passwd"><!ENTITY big "AAAA">]>' +
      '<package format="2"><name>x</name><version>1.0.0</version><description>&xxe; &big; &amp;</description>' +
      '<maintainer email="a@b.c">M</maintainer><license>MIT</license></package>';
    const r = parseManifest(xml, ctx);
    expect(r.description).not.toContain('root:');
    expect(r.description).not.toContain('AAAA');
    expect(r.diagnostics.some((d) => d.message.includes('DOCTYPE'))).toBe(true);
  });

  it('treats embedded HTML/script as inert text', () => {
    const r = parseManifest(base('format="2"', '').replace('Does <b>things</b>.', '<![CDATA[<script>alert(1)</script>]]>'), ctx);
    expect(r.description).toBe('<script>alert(1)</script>');
  });

  it('fails cleanly on pathological nesting', () => {
    const xml = '<package>' + '<a>'.repeat(5000) + '</a>'.repeat(5000) + '</package>';
    const r = parseManifest(xml, ctx);
    expect(r.status).toBe('invalid');
    expect(r.diagnostics[0].category).toBe('parse');
  });

  it('does not misread prototype keys as dependency tags', () => {
    const r = parseManifest(base('format="2"', '<constructor>x</constructor>'), ctx);
    expect(r.deps).toHaveLength(0);
  });
});
