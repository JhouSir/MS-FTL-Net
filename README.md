# MS-FTL-Net
A framework for high-precision long-term monitoring of lake areas on the Yunnan-Guizhou Plateau.

Follow these steps:  
1.Upload SARLabels.csv to your Assets (optional).  
2.Open the GEE Water Classification Tool.js file and set the GEEproject variable in the script to your GEE project ID.  
3.Use the drawing tools on the map to draw an ROI on the "0. ROI Area" layer, and then click "Apply/Update ROI".  
4.If you haven't imported SARLabels.csv, you can use the drawing tools to sample water and non-water points. Once sampling is complete, select "Start Sampling" to automatically calculate attributes, then click "Save Labels to Assets" to save the sample points.  
5.Adjust the time slider to select the date range for water body detection.  
6.Run "Run SAR Water Classification" to classify the water bodies.  
7.Select "Export All Images & Results" to export the classified images to your Google Drive.
