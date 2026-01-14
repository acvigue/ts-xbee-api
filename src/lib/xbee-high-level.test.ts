import * as stream from 'stream';
import { SpecificParsableFrame } from 'ts-xbee-api';
import { describe, expect, it } from 'vitest';
import { fromHex, toHex } from './buffer-tools';
import * as C from './constants';
import { XBee } from './xbee-high-level';

function createMockStream(
  mapping: Array<[string, string[]]>
): stream.Duplex {
  const targetStream = new stream.PassThrough();
  const duplex = new stream.Duplex({
    read() {
      return;
    },
    write: (data, encoding, callback) => {
      targetStream.write(data, encoding, callback);
    },
  });

  targetStream.on('data', (data: Buffer) => {
    const hexData = toHex(data);
    expect(mapping.length, 'to be done receiving messages').toBeGreaterThan(0);
    const [expected, responses] = mapping.shift()!;
    expect(hexData).toEqual(expected);
    for (const response of responses) {
      duplex.push(fromHex(response));
    }
  });

  return duplex;
}

describe('XBee', function () {
  it('should communicate with XBee via duplex stream', async function () {
    const mockStream = createMockStream([
      ['7e00040801415065', ['7e0006880141500001e4']], // AT command AP / response
    ]);
    const xbee = new XBee(mockStream);
    const apMode = await xbee.getParameter(C.AT_COMMAND.AP);
    expect(apMode).toBe('01'); // API mode 1
    xbee.close();
  });

  it('should scan the network', async function () {
    const mockStream = createMockStream([
      ['7e000508014e543c18', ['7e000588014e5400d4']], // set discovery timeout
      [
        '7e000408024e4463', // start discovery
        [
          '7e001988024e4400ed920013a20041aacaf82000fffe0100c105101ef0', // node identification
        ],
      ],
    ]);
    const xbee = new XBee(mockStream);

    const devices: Array<
      SpecificParsableFrame<C.FRAME_TYPE.AT_COMMAND_RESPONSE>
    > = [];
    for await (const device of xbee.scanNetwork(100)) {
      devices.push(device);
    }
    xbee.close();

    expect(devices).toMatchInlineSnapshot(`
      [
        {
          "command": "ND",
          "commandStatus": 0,
          "id": 2,
          "nodeIdentification": {
            "deviceType": 1,
            "digiManufacturerID": "101e",
            "digiProfileID": "c105",
            "nodeIdentifier": " ",
            "remote16": "ed92",
            "remote64": "0013a20041aacaf8",
            "remoteParent16": "fffe",
            "sourceEvent": 0,
          },
          "type": 136,
        },
      ]
    `);
  });
});
