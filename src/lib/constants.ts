/*
 * xbee-api
 * https://github.com/jouz/xbee-api
 *
 * Copyright (c) 2013 Jan Kolkmeier
 * Licensed under the MIT license.
 */

// Physical protocol constants (internal).
export const START_BYTE = 0x7e;
export const ESCAPE = 0x7d;
export const XOFF = 0x13;
export const XON = 0x11;
export const ESCAPE_WITH = 0x20;

export const UNKNOWN_16 = [0xff, 0xfe];
export const UNKNOWN_64 = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff];
export const BROADCAST_16_XB = [0xff, 0xff];
export const COORDINATOR_16 = [0x00, 0x00];
export const COORDINATOR_64 = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

export const ESCAPE_BYTES = [START_BYTE, ESCAPE, XOFF, XON];

export enum FrameType {
  AtCommand = 0x08,
  AtCommandQueueParameterValue = 0x09,
  ZigbeeTransmitRequest = 0x10,
  ExplicitAddressingZigbeeCommandFrame = 0x11,
  RemoteAtCommandRequest = 0x17,
  CreateSourceRoute = 0x21,
  RegisterJoiningDevice = 0x24,
  AtCommandResponse = 0x88,
  ModemStatus = 0x8a,
  ZigbeeTransmitStatus = 0x8b,
  /** [DigiMesh] Emitted when Enable Unicast NACK or Trace Route Enable is set. */
  RouteInformation = 0x8d,
  /** [DigiMesh] Emitted when a node receives an address update and modifies DH/DL. */
  AggregateAddressingUpdate = 0x8e,
  ZigbeeReceivePacket = 0x90,
  ZigbeeExplicitRx = 0x91,
  ZigbeeIoDataSampleRx = 0x92,
  XbeeSensorRead = 0x94,
  NodeIdentification = 0x95,
  RemoteCommandResponse = 0x97,
  OtaFirmwareUpdateStatus = 0xa0,
  RouteRecord = 0xa1,
  DeviceAuthenticatedIndicator = 0xa2,
  MtoRouteRequest = 0xa3,
  RegisterJoiningDeviceStatus = 0xa4,
  JoinNotificationStatus = 0xa5,

  // Series 1 / 802.15.4
  TxRequest64 = 0x00,
  TxRequest16 = 0x01,
  TxStatus = 0x89,
  RxPacket64 = 0x80,
  RxPacket16 = 0x81,
  RxPacket64Io = 0x82,
  RxPacket16Io = 0x83,
}

export enum DiscoveryStatus {
  NoDiscoveryOverhead = 0x00,
  AddressDiscovery = 0x01,
  RouteDiscovery = 0x02,
  AddressAndRouteDiscovery = 0x03,
  ExtendedTimeoutDiscovery = 0x40,
}

export enum DeliveryStatus {
  Success = 0x00,
  MacAckFailure = 0x01,
  CaFailure = 0x02,
  InvalidDestinationEndpoint = 0x15,
  NetworkAckFailure = 0x21,
  NotJoinedToNetwork = 0x22,
  SelfAddressed = 0x23,
  AddressNotFound = 0x24,
  RouteNotFound = 0x25,
  BroadcastSourceFailed = 0x26,
  InvalidBindingTableIndex = 0x2b,
  ResourceError = 0x2c,
  AttemptedBroadcastWithApsTrans = 0x2d,
  ResourceErrorB = 0x32,
  DataPayloadTooLarge = 0x74,
  IndirectMessageUnrequested = 0x75,
}

export enum CommandStatus {
  Ok = 0x00,
  Error = 0x01,
  InvalidCommand = 0x02,
  InvalidParameter = 0x03,
  RemoteCmdTransFailure = 0x04,
}

export enum ModemStatus {
  HardwareReset = 0x00,
  WatchdogReset = 0x01,
  JoinedNetwork = 0x02,
  Disassociated = 0x03,
  CoordinatorStarted = 0x06,
  SecurityKeyUpdated = 0x07,
  VoltageSupplyLimitExceeded = 0x0d,
  ConfigurationChangedDuringJoin = 0x11,
  StackError = 0x80,
}

export enum ReceiveOption {
  PacketAcknowledged = 0x01,
  PacketWasBroadcast = 0x02,
  PacketEncrypted = 0x20,
  PacketSentFromEndDevice = 0x40,
}

export enum DeviceType {
  Coordinator = 0x00,
  Router = 0x01,
  EndDevice = 0x02,
}

// Internal: used by frame-parser for I/O sample decoding.
export const DIGITAL_CHANNELS = {
  MASK: {
    0: ['DIO0', 'AD0'],
    1: ['DIO1', 'AD1'],
    2: ['DIO2', 'AD2'],
    3: ['DIO3', 'AD3'],
    4: ['DIO4'],
    5: ['DIO5', 'ASSOCIATE'],
    6: ['DIO6', 'RTS'],
    7: ['DIO7', 'CTS'],
    10: ['DIO10', 'RSSI'],
    11: ['DIO11', 'PWM'],
    12: ['DIO12', 'CD'],
  } as const,
};

export const ANALOG_CHANNELS = {
  MASK: {
    0: ['AD0', 'DIO0'],
    1: ['AD1', 'DIO1'],
    2: ['AD2', 'DIO2'],
    3: ['AD3', 'DIO3'],
    7: ['SUPPLY'],
  } as const,
};

export enum AtCommand {
  // Network commands
  /** Extended PAN ID */
  ID = 'ID',
  /** Scan Channels */
  SC = 'SC',
  /** Scan Duration */
  SD = 'SD',
  /** Zigbee Stack Profile */
  ZS = 'ZS',
  /** Node Join Time */
  NJ = 'NJ',
  /** Network Watchdog Timeout */
  NW = 'NW',
  /** Coordinator Join Verification */
  JV = 'JV',
  /** Join Notification */
  JN = 'JN',
  /** Operating Extended PAN ID */
  OP = 'OP',
  /** Operating 16-bit PAN ID */
  OI = 'OI',
  /** Operating Channel */
  CH = 'CH',
  /** Number of Remaining Children */
  NC = 'NC',
  /** Coordinator Enable */
  CE = 'CE',
  /** Miscellaneous Device Options */
  DO = 'DO',
  /** Joining Device Controls */
  DC = 'DC',
  /** Initial 16-bit PAN ID */
  II = 'II',
  /** Energy Detect */
  ED = 'ED',

  // Addressing commands
  /** Serial Number High */
  SH = 'SH',
  /** Serial Number Low */
  SL = 'SL',
  /** 16-bit Network Address */
  MY = 'MY',
  /** 16-bit Parent Network Address */
  MP = 'MP',
  /** Destination Address High */
  DH = 'DH',
  /** Destination Address Low */
  DL = 'DL',
  /** Node Identifier */
  NI = 'NI',
  /** Maximum Unicast Hops */
  NH = 'NH',
  /** Broadcast Hops */
  BH = 'BH',
  /** Aggregate Routing Notification */
  AR = 'AR',
  /** Device Type Identifier */
  DD = 'DD',
  /** Node Discover Timeout */
  NT = 'NT',
  /** Network Discovery Options */
  NO = 'NO',
  /** Maximum Packet Payload Bytes */
  NP = 'NP',
  /** Conflict Report */
  CR = 'CR',

  // Zigbee addressing commands
  /** Source Endpoint */
  SE = 'SE',
  /** Destination Endpoint */
  DE = 'DE',
  /** Cluster ID */
  CI = 'CI',
  /** Transmit Options */
  TO = 'TO',

  // RF interfacing commands
  /** TX Power Level */
  PL = 'PL',
  /** Power at PL4 */
  PP = 'PP',
  /** Power Mode */
  PM = 'PM',

  // Security commands
  /** Encryption Enable */
  EE = 'EE',
  /** Encryption Options */
  EO = 'EO',
  /** Link Key */
  KY = 'KY',
  /** Trust Center Network Key */
  NK = 'NK',

  // Serial interfacing commands
  /** Interface Data Rate */
  BD = 'BD',
  /** Parity */
  NB = 'NB',
  /** Stop Bits */
  SB = 'SB',
  /** Packetization Timeout */
  RO = 'RO',
  /** DIO6/RTS */
  D6 = 'D6',
  /** DIO7/CTS */
  D7 = 'D7',
  /** API Enable */
  AP = 'AP',
  /** API Options */
  AO = 'AO',

  // Command mode options
  /** Command Mode Timeout */
  CT = 'CT',
  /** Guard Times */
  GT = 'GT',
  /** Command Character */
  CC = 'CC',
  /** Exit Command mode */
  CN = 'CN',

  // Sleep commands
  /** Sleep Period */
  SP = 'SP',
  /** Number of Cycles Between ON_SLEEP */
  SN = 'SN',
  /** Sleep Mode */
  SM = 'SM',
  /** Time before Sleep */
  ST = 'ST',
  /** Sleep Options */
  SO = 'SO',
  /** Wake Host Delay */
  WH = 'WH',
  /** Polling Rate */
  PO = 'PO',

  // I/O settings commands
  /** AD0/DIO0 Configuration */
  D0 = 'D0',
  /** AD1/DIO1/PTI_En Configuration */
  D1 = 'D1',
  /** AD2/DIO2 Configuration */
  D2 = 'D2',
  /** AD3/DIO3 Configuration */
  D3 = 'D3',
  /** DIO4 Configuration */
  D4 = 'D4',
  /** DIO5/Associate Configuration */
  D5 = 'D5',
  /** DIO8/DTR/SLP_RQ */
  D8 = 'D8',
  /** DIO9/ON_SLEEP */
  D9 = 'D9',
  /** RSSI/PWM0 Configuration */
  P0 = 'P0',
  /** DIO11/PWM1 Configuration */
  P1 = 'P1',
  /** DIO12 Configuration */
  P2 = 'P2',
  /** DIO13/DOUT Configuration */
  P3 = 'P3',
  /** DIO14/DIN */
  P4 = 'P4',
  /** DIO15/SPI_MISO */
  P5 = 'P5',
  /** SPI_MOSI Configuration */
  P6 = 'P6',
  /** DIO17/SPI_SSEL  */
  P7 = 'P7',
  /** DIO18/SPI_SCLK */
  P8 = 'P8',
  /** DIO19/SPI_ATTN/PTI_DATA */
  P9 = 'P9',
  /** Pull-up/Down Resistor Enable */
  PR = 'PR',
  /** Pull Up/Down Direction */
  PD = 'PD',
  /** Associate LED Blink Time */
  LT = 'LT',
  /** RSSI PWM Timer */
  RP = 'RP',

  // I/O sampling commands
  /** I/O Sample Rate */
  IR = 'IR',
  /** Digital Change Detection */
  IC = 'IC',
  /** Voltage Supply Monitoring */
  V_PLUS = 'V+',

  // Diagnostic commands
  /** Firmware Version */
  VR = 'VR',
  /** Hardware Version */
  HV = 'HV',
  /** Association Indication */
  AI = 'AI',
  /** Voltage Supply Monitoring */
  PERCENT_V = '%V',
  /** Received Signal Strength */
  DB = 'DB',
  /** Temperature */
  TP = 'TP',
  /** Version Long */
  VL = 'VL',

  // Execution commands
  /** Apply Changes */
  AC = 'AC',
  /** Active Scan */
  AS = 'AS',
  /** Write */
  WR = 'WR',
  /** Restore Defaults */
  RE = 'RE',
  /** Software Reset */
  FR = 'FR',
  /** Network Reset */
  NR = 'NR',
  /** Sleep Immediately */
  SI = 'SI',
  /** Commissioning Pushbutton */
  CB = 'CB',
  /** Clear Binding and Group Tables */
  AMP_X = '&X',
  /** Node Discovery */
  ND = 'ND',
  /** Destination Node */
  DN = 'DN',
  /** Disable Joining */
  DJ = 'DJ',
  /** Force Sample */
  IS = 'IS',
}
