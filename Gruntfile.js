module.exports = function(grunt) {
	
	//load tasks
	grunt.loadNpmTasks('grunt-contrib-coffee');
	
	// Project configuration.
	grunt.initConfig({
	    pkg: grunt.file.readJSON('package.json'),
	    
	    coffee: {
	    	compile:{
				options: {
					sourceMap: true
					},
				files: [{
					expand: true,
					flatten: true,
					cwd: 'src/',
					src: ['*.coffee'],
					dest: 'lib/',
					ext: '.js'
					}]
	    	}
		}
	    
	});
  
  grunt.registerTask('default', ['coffee:compile']);
  
};