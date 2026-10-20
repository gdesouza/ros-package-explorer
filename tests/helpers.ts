export const manifest = (name: string, body = '', format = 2) =>
  `<package format="${format}"><name>${name}</name><version>0.1.0</version><description>d ${name}</description>` +
  `<maintainer email="a@b.c">M</maintainer><license>MIT</license>${body}</package>`;
