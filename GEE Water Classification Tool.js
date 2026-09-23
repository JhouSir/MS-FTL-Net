// GEE Water Classification Tool
//Powered by Wenchun Zhou.

// ================= Initialization Parameters =================
var start = ee.Date('2015-12-01');
var end = ee.Date('2026-4-1');
var GEEproject = 'Your GEE project'
var modelAssetPath = GEEproject + '/assets/WaterSARTrainedModel';
var labelsAssetPath = GEEproject + '/assets/WaterSARLabels';

// Water classification configuration
var categories = {
  'Non-water': 1,
  'Water': 2
};
var colors = {
  'Non-water': 'brown',
  'Water': 'blue'
};
var riskColors = ['brown', 'blue'];
var categories_list = ee.List(['Non-water', 'Water']);

// Define feature lists
var s2Features = ['NDWI', 'NDBI', 'NDVI'];
var s1Features = [
  'VV', 'VH', 'VV_Filtered', 'VH_Filtered', 'VV_VH_Ratio', 'Total_Intensity', 'SDWI', 'slope',
  'VV_contrast', 'VV_entropy', 'VV_asm', 'VV_correlation',
  'VH_contrast', 'VH_entropy', 'VH_asm', 'VH_correlation',
  'VV_stdDev', 'VH_stdDev'
];
var allFeatures = s1Features.concat(s2Features);

// ================= UI Components Initialization =================
var Map = ui.Map();
var mainPanel = ui.Panel({
  style: { width: '280px', padding: '1px', backgroundColor: '#0a2342', borderRadius: '1px' }
});

// Time slider
var dateSlider = ui.Slider({
  min: 0, max: 100, value: 0, step: 1,
  style: { position: 'bottom-left', width: '250px', height: '20px', backgroundColor: '#2f435c', color: '#ffffff' }
});
var currentDateLabel = ui.Label('', {
  width: '250px', textAlign: 'center', backgroundColor: '#2f435c', fontWeight: 'bold', color: '#ffffff'
});

// Control button panels
var buttonPanel = ui.Panel({ layout: ui.Panel.Layout.flow('horizontal'), style: { stretch: 'horizontal', width: '250px', margin: '0 5px 0 5px', backgroundColor: '#284764' } });
var buttonPanel_export = ui.Panel({ style: { width: '250px', margin: '5px 5px 0 5px', backgroundColor: '#284764' } });

// Button definitions
var sampleButton = ui.Button({ label: 'Start Sampling', onClick: startWaterSampling, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '0 5px 0 5px', border: 'none', borderRadius: '4px' } });
var runButton = ui.Button({ label: 'Run SAR Water Classification', onClick: runWaterClassification, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '0 5px 0 5px', border: 'none', borderRadius: '4px' } });
var exportModelButton = ui.Button({ label: 'Export Model', onClick: exportTrainedModel, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '5px 5px 0 5px', border: 'none', borderRadius: '4px' } });
var loadModelButton = ui.Button({ label: 'Load Model', onClick: loadTrainedModel, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '5px 5px 0 5px', border: 'none', borderRadius: '4px' } });
var exportButton = ui.Button({ label: 'Export Labels', onClick: exportLabels, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '5px 5px 0 5px', border: 'none', borderRadius: '4px' } });
var exportImageButton = ui.Button({ label: 'Export All Images & Results', onClick: exportAllResults, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '5px 5px 0 5px', border: 'none', borderRadius: '4px' } });
var saveButton = ui.Button({ label: 'Save Labels to Assets', onClick: saveToAssets, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '5px 5px 0 5px', border: 'none', borderRadius: '4px' } });
var clearButton = ui.Button({ label: 'Clear Sampling Points', onClick: clearSampling, style: { stretch: 'horizontal', backgroundColor: '#78899e', color: '#402C19', fontSize: '12px', padding: '4px', margin: '5px 5px 0 5px', border: 'none', borderRadius: '4px' } });
var applyRoiButton = ui.Button({ label: 'Apply/Update ROI', onClick: manualApplyRoi, style: { stretch: 'horizontal', backgroundColor: '#ff9800', color: '#000000', fontSize: '12px', padding: '4px', margin: '0px', border: 'none', borderRadius: '4px', fontWeight: 'bold' } });

buttonPanel.add(sampleButton).add(runButton);
buttonPanel_export.add(exportButton).add(exportModelButton).add(loadModelButton).add(exportImageButton).add(saveButton).add(clearButton);

// ================= Global Variables =================
var selectedLake, currentSARImage, currentOpticalImage, waterPoints = ee.FeatureCollection([]);
var labelsFC = null, labelsLoaded = false;
var availableDates = [];
var drawingTools = Map.drawingTools();
var selectedDateIndex = 0;
var cachedSARCollection;
var classifiedImageS2 = null, classifiedImageS1 = null, classifiedImageAll = null, trainedClassifier = null;
var legendPanel;

// ================= Layer Initialization =================
drawingTools.clear(); // Clear default layers

// 1. Create independent ROI layer
var roiLayer = ui.Map.GeometryLayer({
  geometries: [],
  name: '0. ROI Area (Draw Polygon/Rectangle)',
  color: 'red',
  shown: true,
  locked: false
});
drawingTools.layers().add(roiLayer);

// 2. Create independent sampling point layers (by category)
var sampleLayersConfig = [];
for (var category in categories) {
  var layer = ui.Map.GeometryLayer({
    geometries: [],
    name: 'Sample: ' + category,
    color: colors[category],
    shown: true,
    locked: false
  });
  drawingTools.layers().add(layer);
  sampleLayersConfig.push({
    layer: layer,
    category: category,
    label: categories[category]
  });
}

// ================= Core Functional Functions =================

// Helper function: Clear specific layer
function clearLayer(layer) {
  layer.geometries([]);
}

// Check and apply ROI (Internal use) - Always selects the last drawn polygon
function checkAndApplyRoi() {
  var roiGeoms = roiLayer.geometries();
  var count = roiGeoms.length();
  
  if (count > 0) {
    var lastGeom = roiGeoms.get(count - 1);
    // Ensure we store it as a Feature, but we will extract geometry when using it
    selectedLake = ee.Feature(ee.Geometry(lastGeom));
    return true;
  } else {
    selectedLake = null;
    return false;
  }
}

// Manually apply ROI and clean up extra geometries
function manualApplyRoi() {
  var roiGeoms = roiLayer.geometries();
  var count = roiGeoms.length();

  if (count === 0) {
    print('Error: No geometries found in "0. ROI Area" layer.');
    print('Please ensure you selected the "0. ROI Area" layer in the drawing tools before drawing!');
    return;
  }

  if (count > 1) {
    print('Detected ' + count + ' ROI geometries. Cleaning up, keeping only the latest...');
    var lastGeom = roiGeoms[count - 1];
    
    // Reset the layer to avoid any internal state corruption
    roiLayer.geometries([]);
    
    // Re-add the last geometry. This forces a refresh of the layer's internal state.
    roiLayer.geometries([lastGeom]);
    print('ROI layer cleaned.');
  }

  checkAndApplyRoi();
  
  if (selectedLake) {
    print('ROI applied successfully. Refreshing images...');
    // Force update dates and images
    updateAvailableDates();
  } 
}

function checkAssetExistence(assetName) {
  try { return !!ee.data.getAsset(assetName); } catch (e) { return false; }
}

function loadLabelsIfNotLoaded(callback) {
  if (labelsLoaded) { callback(); return; }
  print('Checking SAR water label asset:', labelsAssetPath);
  var labelsExist = checkAssetExistence(labelsAssetPath);
  if (labelsExist) {
    try {
      var testCollection = ee.FeatureCollection(labelsAssetPath);
      testCollection.first().evaluate(function(result) {
        if (result) { labelsFC = testCollection; } else { labelsFC = ee.FeatureCollection([]); }
        labelsLoaded = true; 
        print('Label dataset loaded. Total features:', labelsFC.size().getInfo());
        callback();
      }, function() { labelsFC = ee.FeatureCollection([]); labelsLoaded = true; callback(); });
    } catch (e) { labelsFC = ee.FeatureCollection([]); labelsLoaded = true; callback(); }
  } else {
    print('Warning: SAR water label asset does not exist. Creating empty collection.');
    labelsFC = ee.FeatureCollection([]); labelsLoaded = true; callback();
  }
}

function checkSamplingExists() {
  loadLabelsIfNotLoaded(function() {
    if (!selectedLake || !availableDates[selectedDateIndex]) {
      sampleButton.style().set('backgroundColor', '#78899e');
      sampleButton.setLabel('Start Sampling');
      currentDateLabel.style().set('backgroundColor', '#2f435c');
      return;
    }
    
    var currentDate = availableDates[selectedDateIndex];
    var allRelevantSamples = waterPoints.size().getInfo() > 0 ? labelsFC.merge(waterPoints) : labelsFC;
    
    // FIX: Use .geometry() explicitly for filterBounds
    var existingSamples = allRelevantSamples.filter(ee.Filter.eq('Date', currentDate)).filterBounds(selectedLake.geometry());

    existingSamples.size().evaluate(function(count) {
      if (count > 0) {
        sampleButton.style().set('backgroundColor', '#ff0000');
        sampleButton.setLabel('Overwrite Existing Samples');
        currentDateLabel.style().set('backgroundColor', '#ffcd48');
      } else {
        sampleButton.style().set('backgroundColor', '#78899e');
        sampleButton.setLabel('Start Sampling');
        currentDateLabel.style().set('backgroundColor', '#2f435c');
      }
    });
  });
}

dateSlider.onChange(function (value) {
  if (availableDates.length > 0 && value < availableDates.length) {
    selectedDateIndex = value;
    currentDateLabel.setValue(availableDates[selectedDateIndex]);
    if (selectedLake) { updateImage(); }
  }
});

function updateAvailableDates() {
  if (!selectedLake) return;
  // FIX: Use .geometry() explicitly for filterBounds
  cachedSARCollection = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(selectedLake.geometry()).filterDate(start, end)
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

  var sarDates = cachedSARCollection.aggregate_array('system:time_start');
  var uniqueSARDates = ee.List(sarDates).distinct().sort();
  var dateStrings = uniqueSARDates.map(function(date) { return ee.Date(date).format('YYYY-MM-dd'); }).distinct();

  dateStrings.evaluate(function(result) {
    availableDates = result;
    if (availableDates.length > 0) {
      dateSlider.setMax(availableDates.length - 1);
      dateSlider.setValue(0);
      selectedDateIndex = 0;
      currentDateLabel.setValue(availableDates[0]);
      updateImage();
    } else { 
      print('No SAR images available for this ROI in this time period'); 
      currentDateLabel.setValue('No images');
    }
  });
}

// ================= S1/S2 Loading Methods =================

// Calculate SDWI
function calculateSDWI(image) {
  var vv = image.select('VV');
  var vh = image.select('VH');
  var sdwi = vv.multiply(vh).divide(1000).exp().rename('SDWI');
  return image.addBands(sdwi).copyProperties(image, ["system:time_start"]);
}

// Calculate Sentinel-2 Cloud Mask
function calculateS2CloudMask(image) {
  var qa = image.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0).and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(mask).copyProperties(image, ["system:time_start"]);
}

// Calculate Sentinel-2 Indices
function calculateIndices(image) {
  var green = image.select('B3'), red = image.select('B4'), nir = image.select('B8'), swir = image.select('B11');
  var ndwi = green.subtract(nir).divide(green.add(nir)).rename('NDWI');
  var ndbi = swir.subtract(nir).divide(swir.add(nir)).rename('NDBI');
  var ndvi = nir.subtract(red).divide(nir.add(red)).rename('NDVI');
  return image.addBands([ndwi, ndbi, ndvi]).copyProperties(image, ["system:time_start"]);
}

// Calculate Slope
function addSlopeBand(image) {
  var elevation = ee.ImageCollection('COPERNICUS/DEM/GLO30').mosaic().select('DEM');
  var slope = ee.Terrain.slope(elevation).rename('slope');
  return image.addBands(slope).copyProperties(image, ["system:time_start"]);
}

// Texture features
function addTextureFeatures(image) {
  var vv = image.select('VV_Filtered').unitScale(-50, 5).multiply(255).toInt8();
  var vh = image.select('VH_Filtered').unitScale(-50, 5).multiply(255).toInt8();
  var kernel = ee.Kernel.square({radius: 1});
  
  var vv_glcm = vv.glcmTexture({kernel: kernel});
  var vh_glcm = vh.glcmTexture({kernel: kernel});
  
  var bandsToAdd = [
    vv_glcm.select('VV_Filtered_contrast').rename('VV_contrast'),
    vv_glcm.select('VV_Filtered_ent').rename('VV_entropy'),
    vv_glcm.select('VV_Filtered_asm').rename('VV_asm'),
    vv_glcm.select('VV_Filtered_corr').rename('VV_correlation'),
    vh_glcm.select('VH_Filtered_contrast').rename('VH_contrast'),
    vh_glcm.select('VH_Filtered_ent').rename('VH_entropy'),
    vh_glcm.select('VH_Filtered_asm').rename('VH_asm'),
    vh_glcm.select('VH_Filtered_corr').rename('VH_correlation')
  ];
  return image.addBands(bandsToAdd).copyProperties(image, ["system:time_start"]);
}

// Spatial continuity features
function addSpatialContinuityFeatures(image) {
  var vv = image.select('VV_Filtered');
  var vh = image.select('VH_Filtered');
  var kernel = ee.Kernel.square({radius: 1});
  var vv_std = vv.reduceNeighborhood({reducer: ee.Reducer.stdDev(), kernel: kernel}).rename('VV_stdDev');
  var vh_std = vh.reduceNeighborhood({reducer: ee.Reducer.stdDev(), kernel: kernel}).rename('VH_stdDev');
  return image.addBands([vv_std, vh_std]).copyProperties(image, ["system:time_start"]);
}

// SAR indices
function add_sar_indices(image) {
  var vv = image.select('VV_Filtered'), vh = image.select('VH_Filtered');
  return image.addBands([vv.divide(vh).rename('VV_VH_Ratio'), vv.add(vh).rename('Total_Intensity')]).copyProperties(image, ["system:time_start"]);
}

// Filter speckles
function filterSpeckles(img) {
  var vv_smoothed = img.select('VV').focal_median(100, 'circle', 'meters').rename('VV_Filtered');
  var vh_smoothed = img.select('VH').focal_median(100, 'circle', 'meters').rename('VH_Filtered');
  return img.addBands(vv_smoothed).addBands(vh_smoothed).copyProperties(img, ["system:time_start"]);
}

// Load Sentinel-1
function loadSentinel() {
  var selectedDateStr = availableDates[selectedDateIndex];
  var startDate = ee.Date(selectedDateStr);
  var endDate = startDate.advance(1, 'day');

  var lakeGeom = selectedLake.geometry();

  var sentinelImage = cachedSARCollection
    .filterDate(startDate, endDate)
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .map(function(img) {
      return img.clip(lakeGeom).copyProperties(img, ["system:time_start"]);
    })
    .map(filterSpeckles)
    .map(add_sar_indices)
    .map(calculateSDWI)
    .map(addSlopeBand)
    .map(addTextureFeatures)
    .map(addSpatialContinuityFeatures)
    .median()
    .clip(lakeGeom);

  return sentinelImage;
}

// Calculate coverage area
function calculateCoverageArea(image, lakeGeometry) {
  var bandNames = image.bandNames();
  var bandCount = bandNames.size();
  var hasBands = bandCount.gt(0);
  
  var result = ee.Algorithms.If(
    hasBands,
    ee.Algorithms.If(
      image.bandNames().size().gt(0),
      function() {
        var mask = image.mask().reduce(ee.Reducer.sum());
        var validPixels = mask.gt(0);
        var coveredArea = validPixels.multiply(ee.Image.pixelArea()).reduceRegion({
          reducer: ee.Reducer.sum(), geometry: lakeGeometry, scale: 10, maxPixels: 1e9, bestEffort: true
        });
        var totalArea = ee.Number(lakeGeometry.area(1)); 
        return ee.Number(coveredArea.get('sum')).divide(totalArea);
      }(),
      ee.Number(0)
    ),
    ee.Number(0)
  );
  return ee.Number(result);
}

// Load Sentinel-2
function loadS2() {
  if (!selectedLake || availableDates.length === 0) return null;
  var selectedDateStr = availableDates[selectedDateIndex];
  var centerDate = ee.Date(selectedDateStr);
  
  var lakeGeom = selectedLake.geometry();

  var getMedianImage = function(startDate, endDate) {
    return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
      .filterBounds(lakeGeom) 
      .filterDate(startDate, endDate)
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
      .sort('CLOUDY_PIXEL_PERCENTAGE')
      .limit(10)
      .map(calculateS2CloudMask)
      .map(calculateIndices)
      .map(function(img) { return img.clip(lakeGeom).copyProperties(img, ["system:time_start"]); })
      .median();
  };

  var col10 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(lakeGeom).filterDate(centerDate.advance(-10, 'day'), centerDate).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));
  var col30 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(lakeGeom).filterDate(centerDate.advance(-30, 'day'), centerDate).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));
  var col60 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(lakeGeom).filterDate(centerDate.advance(-60, 'day'), centerDate).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));
  var col180 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(lakeGeom).filterDate(centerDate.advance(-180, 'day'), centerDate).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));

  var med10 = getMedianImage(centerDate.advance(-10, 'day'), centerDate);
  var med30 = getMedianImage(centerDate.advance(-30, 'day'), centerDate);
  var med60 = getMedianImage(centerDate.advance(-60, 'day'), centerDate);
  var med180 = getMedianImage(centerDate.advance(-180, 'day'), centerDate);
  var med3y = getMedianImage(centerDate.advance(-3, 'year'), centerDate.advance(3, 'year'));

  var cov10 = calculateCoverageArea(med10, lakeGeom);
  var cov30 = calculateCoverageArea(med30, lakeGeom);
  var cov60 = calculateCoverageArea(med60, lakeGeom);
  var cov180 = calculateCoverageArea(med180, lakeGeom);

  var result = ee.Algorithms.If(
    col10.size().gt(0).and(cov10.gte(0.98)), med10,
    ee.Algorithms.If(
      col30.size().gt(0).and(cov30.gte(0.98)), med30,
      ee.Algorithms.If(
        col60.size().gt(0).and(cov60.gte(0.98)), med60,
        ee.Algorithms.If(
          col180.size().gt(0).and(cov180.gte(0.98)), med180,
          med3y
        )
      )
    )
  );
  return ee.Image(result);
}

// Combine S1 and S2
function combineS1S2Images() {
  if (!currentSARImage || !currentOpticalImage) {
    print('Missing SAR or optical image data, cannot combine'); return null;
  }
  return currentSARImage.addBands(currentOpticalImage.select(s2Features));
}

function clearMapLayers() {
  var layers = Map.layers();
  for (var i = layers.length()-1; i >= 0; i--) {
    if (layers.get(i).get('name') !== 'Legend Panel') Map.remove(layers.get(i));
  }
}

function updateImage() {
  if (!selectedLake || availableDates.length === 0) return;
  clearMapLayers();
  
  currentSARImage = loadSentinel();
  currentOpticalImage = loadS2();

  var sarVis = { min: -25, max: 0, bands: ['VV', 'VV', 'VV'], gamma: 1.2 };
  if (currentOpticalImage) {
    var opticalVis = { min: 0, max: 3000, bands: ['B4', 'B3', 'B2'], gamma: 1.2 };
    Map.addLayer(currentOpticalImage, opticalVis, 'Sentinel-2 Optical');
  }
  Map.addLayer(currentSARImage, sarVis, 'Sentinel-1 SAR');

  checkSamplingExists();
}

function startWaterSampling() {
  if (!selectedLake) {
    print('Error: Please draw a polygon in the "0. ROI Area" layer and click "Apply/Update ROI" first!');
    return;
  }
  
  sampleButton.setLabel('Extracting SAR Water Data...');
  var pointsCollection = ee.FeatureCollection([]);
  var hasPoints = false;
  
  for (var i = 0; i < sampleLayersConfig.length; i++) {
    var config = sampleLayersConfig[i];
    var geoms = config.layer.geometries();
    if (geoms.length > 0) {
      hasPoints = true;
      var fc = ee.FeatureCollection(geoms.map(function(geom) {
        return ee.Feature(geom).set({
          'Id': ee.Feature(geom).id(),
          'LakeName': 'Custom_ROI', 
          'Date': availableDates[selectedDateIndex],
          'Category': config.category,
          'Label': config.label
        });
      }));
      pointsCollection = pointsCollection.merge(fc);
    }
  }
  
  if (!hasPoints) {
    print('Error: Please draw sampling points on the corresponding "Sample: xxx" layers!');
    sampleButton.setLabel('Start Sampling');
    return;
  }

  var combinedImage = combineS1S2Images();
  if (!combinedImage) {
    print('Error: Image combination failed.');
    sampleButton.setLabel('Start Sampling');
    return;
  }

  var sampledPoints = combinedImage.sampleRegions({
    collection: pointsCollection, properties: ['Id', 'LakeName', 'Date', 'Label', 'Category'], scale: 10, geometries: true
  });
  waterPoints = sampledPoints;
  print('SAR water sampling completed. Total points:', pointsCollection.size().getInfo());
  checkSamplingExists();
}

function runWaterClassification() {
  if (!selectedLake) { 
    print('Error: ROI is not set. Please draw a polygon in the "0. ROI Area" layer and click "Apply/Update ROI" first!'); 
    return; 
  }
  loadLabelsIfNotLoaded(function() {
    print('Performing SAR water classification...');
    var hasCurrentPoints = waterPoints.size().gt(0);
    var hasLabelsData = labelsFC ? labelsFC.size().gt(0) : ee.Number(0);
    var canRunDetection = hasCurrentPoints.or(hasLabelsData);

    canRunDetection.evaluate(function (canRun) {
      if (!canRun) { print('Error: No available data points for SAR water classification.'); return; }

      var filteredSample = labelsFC && labelsFC.size().getInfo() > 0 ? labelsFC.merge(waterPoints) : waterPoints;
      var trainingSample = filteredSample.randomColumn('random', 12345).filter(ee.Filter.lt('random', 0.8));
      var validationSample = filteredSample.randomColumn('random', 12345).filter(ee.Filter.gte('random', 0.8));

      trainingSample.size().evaluate(function (trainingSize) {
        validationSample.size().evaluate(function (validationSize) {
          if (trainingSize === 0 || validationSize === 0) { print('Insufficient training or validation samples'); return; }

          var numberOfTrees = 10;
          var combinedImage = combineS1S2Images();
          if (!combinedImage) {
             print('Error: Cannot run classification without combined S1 and S2 images.');
             return;
          }

          var classifierS2 = ee.Classifier.smileRandomForest({ numberOfTrees: numberOfTrees }).setOutputMode('CLASSIFICATION').train({
            features: trainingSample, classProperty: 'Label', inputProperties: s2Features
          });
          var classifierS1 = ee.Classifier.smileRandomForest({ numberOfTrees: numberOfTrees }).setOutputMode('CLASSIFICATION').train({
            features: trainingSample, classProperty: 'Label', inputProperties: s1Features
          });
          trainedClassifier = ee.Classifier.smileRandomForest({ numberOfTrees: numberOfTrees }).setOutputMode('CLASSIFICATION').train({
            features: trainingSample, classProperty: 'Label', inputProperties: allFeatures
          });

          var valAll = validationSample.classify(trainedClassifier);
          var accAll = valAll.errorMatrix('Label', 'classification');
          print('S1+S2 fused classification validation accuracy:', accAll.accuracy());

          classifiedImageS2 = currentOpticalImage.select(s2Features).classify(classifierS2);
          classifiedImageS1 = currentSARImage.select(s1Features).classify(classifierS1);
          classifiedImageAll = combinedImage.select(allFeatures).classify(trainedClassifier);

          Map.addLayer(classifiedImageS2, {palette: riskColors, min: 1, max: 2}, 'S2 Water Classification', true);
          Map.addLayer(classifiedImageS1, {palette: riskColors, min: 1, max: 2}, 'S1 Water Classification', true);
          Map.addLayer(classifiedImageAll, {palette: riskColors, min: 1, max: 2}, 'S1+S2 Water Classification', true);

          createLegendForClassification();
          print('Three water classification results generated and added to map!');
        });
      });
    });
  });
}

function createLegendForClassification() {
  if (legendPanel) legendPanel.clear();
  else {
    legendPanel = ui.Panel({style: {position: 'bottom-right', padding: '8px 15px', backgroundColor: 'rgba(255, 255, 255, 0.8)', shown: true}});
    Map.add(legendPanel);
  }
  legendPanel.add(ui.Label({value: 'SAR Water Classification Legend', style: {fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0', color: '#4e4a4b'}}));
  for (var category in categories) {
    legendPanel.add(ui.Panel({
      widgets: [
        ui.Label({value: ' ', style: {backgroundColor: colors[category], padding: '8px', margin: '0 8px 4px 0', stretch: 'horizontal'}}),
        ui.Label({value: category, style: {margin: '0 0 4px 0', color: '#4e4a4b'}})
      ],
      layout: ui.Panel.Layout.flow('horizontal')
    }));
  }
}

function exportTrainedModel() {
  if (!trainedClassifier) { print('No trained model available to export'); return; }
  var dummy = ee.Feature(selectedLake.geometry());
  var trees = ee.List(ee.Dictionary(trainedClassifier.explain()).get('trees'));
  var col = ee.FeatureCollection(trees.map(function (x) { return dummy.set('tree', x) }));
  Export.table.toAsset({collection: col, description: 'SAR_Water_Model_' + new Date().getTime(), assetId: modelAssetPath, overwrite: true});
  print('SAR water model export task submitted');
}

function loadTrainedModel() {
  if (!checkAssetExistence(modelAssetPath)) { print('Error: WaterSARTrainedModel asset does not exist'); return; }
  try {
    var modelAsset = ee.FeatureCollection(modelAssetPath);
    modelAsset.first().evaluate(function (feature) {
      if (feature && feature.properties && feature.properties.tree) {
        trainedClassifier = ee.Classifier.decisionTreeEnsemble(modelAsset.aggregate_array('tree'));
        print('SAR water model loaded successfully!');
        if (currentSARImage && currentOpticalImage) {
          var combinedImage = combineS1S2Images();
          if(combinedImage) {
             var preclassified = combinedImage.select(allFeatures).classify(trainedClassifier);
             Map.addLayer(preclassified, {palette: riskColors, min: 1, max: 2}, "Pre-classified SAR Water");
          }
        }
      }
    });
  } catch (err) { print('Failed to load model'); }
}

function saveToAssets() {
  loadLabelsIfNotLoaded(function() {
    if (waterPoints.size().getInfo() === 0) { print('No sampling points to save'); return; }
    labelsFC = labelsFC ? labelsFC.merge(waterPoints) : waterPoints;
    print('Samples merged. Total samples:', labelsFC.size().getInfo());
    Export.table.toAsset({collection: labelsFC, description: 'Update_SAR_Labels_' + new Date().getTime(), assetId: labelsAssetPath, overwrite: true});
    print('Save task submitted');
    clearSampling();
  });
}

function exportLabels() {
  if (waterPoints.size().getInfo() > 0) {
    Export.table.toDrive({
      collection: waterPoints,
      description: 'SAR_Water_Samples_' + availableDates[selectedDateIndex].replace(/-/g, ''),
      fileFormat: 'GeoJSON'
    });
    print('Current SAR water sample export started');
  } else { print('No current SAR water sample data available to export'); }
}

function exportAllResults() {
  if (!currentSARImage || !currentOpticalImage) { print('Error: Please load image data first'); return; }
  if (!classifiedImageS2 || !classifiedImageS1 || !classifiedImageAll) { print('Error: Please run water classification first'); return; }

  var dateStr = availableDates[selectedDateIndex].replace(/-/g, '');
  var baseDesc = 'CustomROI_' + dateStr;
  var region = selectedLake.geometry();

  Export.image.toDrive({ image: currentOpticalImage.select(['B8', 'B4', 'B3']), description: 'S2_FalseColor_' + baseDesc, folder: 'GEE_Water_Classification', region: region, scale: 10, maxPixels: 1e9 });
  Export.image.toDrive({ image: currentSARImage.select(['VV', 'VH', 'SDWI']), description: 'S1_VV_VH_SDWI_' + baseDesc, folder: 'GEE_Water_Classification', region: region, scale: 10, maxPixels: 1e9 });
  Export.image.toDrive({ image: classifiedImageS2, description: 'Class_S2_' + baseDesc, folder: 'GEE_Water_Classification', region: region, scale: 10, maxPixels: 1e9 });
  Export.image.toDrive({ image: classifiedImageS1, description: 'Class_S1_' + baseDesc, folder: 'GEE_Water_Classification', region: region, scale: 10, maxPixels: 1e9 });
  Export.image.toDrive({ image: classifiedImageAll, description: 'Class_All_' + baseDesc, folder: 'GEE_Water_Classification', region: region, scale: 10, maxPixels: 1e9 });

  print('Submitted 5 export tasks. Please check the Tasks tab.');
}

function clearSampling() {
  waterPoints = ee.FeatureCollection([]);
  for (var i = 0; i < sampleLayersConfig.length; i++) {
    clearLayer(sampleLayersConfig[i].layer);
  }
  checkSamplingExists();
  print('Sampling points cleared. ROI area remains unchanged.');
}

// ================= UI Layout =================
mainPanel.add(ui.Label({
  value: 'Sentinel-2-SAR Fused Water Classification V5.5',
  style: { fontWeight: 'bold', fontSize: '16px', margin: '5px 5px 5px 15px', textAlign: 'center', color: '#ffffff', backgroundColor: '#071628' }
}));

mainPanel.add(ui.Label('Operation Guide:', { fontWeight: 'bold', color: '#ffff00', backgroundColor: '#0B131B', margin: '0 5px' }));
mainPanel.add(ui.Label('1. Draw polygon in "0. ROI Area" layer', { color: '#fff', backgroundColor: '#0B131B', margin: '0 5px', fontSize: '11px' }));
mainPanel.add(ui.Label('2. Click "Apply/Update ROI" to load images', { color: '#fff', backgroundColor: '#0B131B', margin: '0 5px', fontSize: '11px' }));
mainPanel.add(ui.Label('3. Draw points in "Sample: xx" layers', { color: '#fff', backgroundColor: '#0B131B', margin: '0 5px', fontSize: '11px' }));

var row3 = ui.Panel({ layout: ui.Panel.Layout.flow('horizontal'), style: { width: '240px', backgroundColor: '#96A3B3', margin: '5px 5px 0 10px', padding: '5px' } });
row3.add(applyRoiButton);
mainPanel.add(row3);

mainPanel.add(ui.Label('Select Time:', { fontWeight: 'bold', color: '#ffffff', backgroundColor: '#0B131B', margin: '5px 5px 0 5px' })).add(dateSlider).add(currentDateLabel);
mainPanel.add(buttonPanel);
mainPanel.add(buttonPanel_export);

ui.root.widgets().reset();
ui.root.add(mainPanel);
ui.root.add(Map);
Map.setCenter(102.69325181,24.85953676, 8);

if (!legendPanel) {
  legendPanel = ui.Panel({ style: { position: 'bottom-right', padding: '8px 15px', backgroundColor: 'rgba(255, 255, 255, 0.8)' } });
  legendPanel.add(ui.Label({ value: 'Legend', style: { fontWeight: 'bold', fontSize: '16px', margin: '0 0 4px 0', color: '#4e4a4b' } }));
  legendPanel.add(ui.Label('Waiting for classification results...'));
  Map.add(legendPanel);
}