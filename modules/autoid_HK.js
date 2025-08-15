// modules/autoid_HK.js

const speciesRules = [
  {
    name: 'Hipposideros gentilis',
    rules: [
      {
        callType: 'CF-FM, FM-CF-FM',
        cfStart: [120, 130],
        duration: [5, 10],
        harmonic: [0, 1, 2, 3]
      }
    ]
  },
  {
    name: 'Hipposideros armiger',
    rules: [
      {
        callType: 'CF-FM, FM-CF-FM',
        cfStart: [65, 72],
        duration: [10, 18]
      }
    ]
  },
  {
    name: 'Rhinolophus pusillus',
    rules: [
      {
        callType: 'FM-CF-FM',
        cfStart: [100, 110],
        duration: [30, 70]
      }
    ]
  },
  {
    name: 'Rhinolophus sinicus',
    rules: [
      {
        callType: 'FM-CF-FM',
        cfStart: [75, 87],
        duration: [30, 70]
      }
    ]
  },
  {
    name: 'Rhinolophus affinis',
    rules: [
      {
        callType: 'FM-CF-FM',
        cfStart: [68, 73],
        duration: [30, 80]
      }
    ]
  },
  {
    name: 'Pipistrellus tenuis',
    rules: [
      { // 0.1-5 Bandwidth QCF, FM-QCF
        callType: 'QCF, FM-QCF',
        bandwidth: [0.1, 5],
        lowestFreq: [39, 43.5],
        duration: [6.5, 10]
      },      
      { // 5.1-20 Bandwidth FM-QCF
        callType: 'FM-QCF',
        bandwidth: [5.1, 20],
        highestFreq: [44.1, 62],        
        lowestFreq: [39, 42],
        duration: [5, 9]
      },
      { // 20.1-40 Bandwidth FM-QCF
        callType: 'FM-QCF',
        bandwidth: [20.1, 40], 
        highestFreq: [60.1, 82],        
        lowestFreq: [40.0, 42],
        duration: [5, 8]
      },
      { // 40.1-70 Bandwidth FM, FM-QCF
        callType: 'FM, FM-QCF',
        bandwidth: [40.1, 70], 
        highestFreq: [82.1, 115],        
        lowestFreq: [42.0, 45],
        duration: [3, 7]
      }      
    ]
  },
  {
    name: 'Pipistrellus abramus',
    rules: [
      { // 1-5 Bandwidth FM-QCF, QCF
        callType: 'QCF',
        lowestFreq: [44, 46]
      },
      { // 5.1-15 Bandwidth FM-QCF
        callType: 'FM-QCF',
        bandwidth: [5.1, 15],
        highestFreq: [52.1, 64],        
        lowestFreq: [47, 49],
        duration: [3.5, 7]
      },      
      { // 15.1-45 Bandwidth FM-QCF
        callType: 'FM-QCF',
        bandwidth: [15.1, 45],
        highestFreq: [63.1, 96],        
        lowestFreq: [48, 51],
        duration: [3, 6]
      }
    ]
  },
  {
    name: 'Tylonycteris fulvida',
    rules: [
      { // 1-5 Bandwidth FM-QCF, QCF
        callType: 'FM-QCF, QCF',
        bandwidth: [1, 5],
        highestFreq: [50, 61], 
        lowestFreq: [49, 56],
        duration: [5, 8.5]
      },      
      { // 5.1-15 Bandwidth FM, FM-QCF
        callType: 'FM, FM-QCF',
        bandwidth: [5.1, 15],
        highestFreq: [54.6, 70],        
        lowestFreq: [49.5, 57],
        duration: [5.5, 11]
      },
      { // 15.1-45 Bandwidth FM, FM-QCF
        callType: 'FM, FM-QCF',
        bandwidth: [15.1, 45], 
        highestFreq: [65.1, 100],        
        lowestFreq: [50, 55],
        duration: [6, 11]
      },      
      { // 15.1-60 Bandwidth FM, FM-QCF
        callType: 'FM, FM-QCF',
        bandwidth: [15.1, 60],        
        highestFreq: [70, 115],
        lowestFreq: [55.1, 60],
        duration: [5, 7]
      }      
    ]
  },  
  {
    name: 'Hypsugo pulveratus',
    rules: [
      {
        callType: 'QCF',
        lowestFreq: [32, 36],
        harmonic: [0, 1, 2, 3]
      }
    ]
  },
  {
    name: 'Pipistrellus ceylonicus',
    rules: [
      {
        callType: 'QCF',
        lowestFreq: [30, 32],
        harmonic: [0, 1, 2, 3]
      }
    ]
  },
  {
    name: 'Nyctalus plancyi',
    rules: [
      {
        callType: 'QCF',
        lowestFreq: [17.5, 21],
        harmonic: [0, 1, 2, 3]
      }
    ]
  },
  {
    name: 'Mops plicatus',
    rules: [
      {
        callType: 'QCF',
        lowestFreq: [17.5, 21],
        harmonic: [0, 1, 2, 3]
      },
      {
        callType: 'QCF',
        lowestFreq: [13, 16.5],
        harmonic: [0, 1, 2, 3]
      }
    ]
  },
  {
    name: 'Taphozous melanopogon',
    rules: [
      {
        callType: 'QCF',
        lowestFreq: [24.5, 26],
        harmonic: [0, 1, 2, 3]
      }
    ]
  }
];

function inRange(val, range) {
  if (val == null || isNaN(val)) return false;
  if (Array.isArray(range[0])) return range.some(r => inRange(val, r));
  if (typeof range[0] === 'string' && range.length === 1) {
    const match = range[0].match(/^(=|=>|>=|<|<=|>)\s*(\w+)$/);
    if (match) {
      const op = match[1];
      const refField = match[2];
      return { op, refField };
    }
  }
  const [min, max] = range;
  return val >= min && val <= max;
}

export function autoIdHK(data = {}) {
  const fields = [
    'highestFreq', 'lowestFreq', 'kneeFreq', 'heelFreq',
    'startFreq', 'endFreq', 'cfStart', 'cfEnd', 'duration',
    'bandwidth', 'kneeLowTime', 'kneeLowBandwidth',
    'heelLowBandwidth', 'kneeHeelBandwidth'
  ];

  const matches = speciesRules.filter(species =>
    species.rules.some(rule => {
      if (rule.callType) {
        const callTypes = rule.callType.split(',').map(s => s.trim());
        if (!callTypes.includes(data.callType)) return false;
      }
      if (rule.harmonic && !rule.harmonic.includes(data.harmonic)) return false;
      return fields.every(f => {
        if (!rule[f]) return true;
        if (typeof rule[f][0] === 'string' && rule[f].length === 1) {
          const match = rule[f][0].match(/^(=|=>|>=|<|<=|>)\s*(\w+)$/);
          if (match) {
            const op = match[1];
            const refField = match[2];
            const val = data[f];
            const refVal = data[refField];
            if (val == null || refVal == null || isNaN(val) || isNaN(refVal)) return false;
            switch (op) {
              case '=':
                return val === refVal;
              case '>':
                return val > refVal;
              case '<':
                return val < refVal;
              case '>=':
              case '=>':
                return val >= refVal;
              case '<=':
              case '=<':
                return val <= refVal;
              default:
                return false;
            }
          }
        }
        return inRange(data[f], rule[f]);
      });
    })
  ).map(s => s.name);

  return matches.length ? matches.join(' / ') : 'No species matched';
}
