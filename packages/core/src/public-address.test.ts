import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicAddress } from "./public-address.ts";

test("not public: this machine, private and shared networks, link-local with cloud metadata, multicast, reserved and documentation ranges", () => {
  const v4 = ["0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.254",
    "192.0.0.8", "192.0.2.1", "192.168.0.9", "198.18.0.1", "198.19.255.254", "198.51.100.7", "203.0.113.7", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255"];
  const v6 = ["::", "::1", "0:0:0:0:0:0:0:1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%lo0", "ff02::1", "2001:db8::1", "2002:7f00:1::1"];
  for (const ip of [...v4, ...v6]) assert.equal(isPublicAddress(ip), false, ip);
});

test("an IPv6 address is public only in the space given out to networks: whatever lies outside it, named here or not, is not", () => {
  for (const [ip, what] of [["fec0::1", "site-local"], ["100::1", "discard-only"], ["5f00::1", "segment routing"], ["64:ff9b:1::a00:1", "NAT64 of the local network"],
    ["::ffff:0:7f00:1", "IPv4-translated"], ["1::1", "given out to nobody"], ["4000::1", "given out to nobody"], ["e000::1", "given out to nobody"],
    ["2001::1", "Teredo"], ["2001:2::1", "benchmarking"], ["2001:1ff:ffff::1", "protocol assignments"], ["3fff::1", "documentation"], ["3fff:fff:ffff::1", "documentation"]])
    assert.equal(isPublicAddress(ip), false, `${ip} (${what})`);
  for (const ip of ["2000::1", "2001:200::1", "2003::1", "3fff:1000::1"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("an IPv4 address written inside an IPv6 one is as public as the IPv4 address when mapped or behind NAT64, and never public in the retired compatible form", () => {
  for (const ip of ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "64:ff9b::10.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b::7f00:1",
    "::127.0.0.1", "::7f00:1", "::10.0.0.1", "::192.168.0.9", "::8.8.8.8"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::8.8.8.8", "64:ff9b::808:808"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("public: everything else, up to the edge of each closed range", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "9.255.255.255", "11.0.0.0", "100.63.255.255", "100.128.0.0", "126.255.255.255", "128.0.0.0", "169.253.255.255", "169.255.0.0",
    "172.15.255.255", "172.32.0.1", "192.0.1.1", "192.167.255.255", "192.169.0.0", "198.17.255.255", "198.20.0.0", "223.255.255.255",
    "2606:4700::1", "2a00:1450:4001:81b::200e", "2001:4860:4860::8888", "2003::1"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("text that is no IP address is never public", () => {
  for (const text of ["", "localhost", "example.com", "127.1", "1.2.3", "[::1]", "8.8.8.8:80", "::g"]) assert.equal(isPublicAddress(text), false, text);
});
