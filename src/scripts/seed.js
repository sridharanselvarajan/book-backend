require('dotenv').config();
const mongoose = require('mongoose');
const Movie = require('../models/Movie');
const Show = require('../models/Show');
const User = require('../models/User');
const bcrypt = require('bcrypt');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bookmyshow_clone';

async function seed() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing data (optional - comment out if you want to keep data)
    // await Movie.deleteMany({});
    // await Show.deleteMany({});
    // await User.deleteMany({ role: { $ne: 'ADMIN' } });

    // Create admin user
    const adminEmail = 'admin@bookmyshow.com';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      admin = await User.create({
        name: 'Admin User',
        email: adminEmail,
        password: hashedPassword,
        role: 'ADMIN',
        phone: '+1234567890',
      });
      console.log('✅ Admin user created:', admin.email);
    } else {
      console.log('ℹ️  Admin user already exists');
    }

    // Create sample movies
    const movies = [
      {
        title: 'Avengers: Endgame',
        description: 'The epic conclusion to the Infinity Saga.',
        genre: ['Action', 'Adventure', 'Sci-Fi'],
        duration: 181,
        language: 'English',
        releaseDate: new Date('2019-04-26'),
        rating: 8.4,
        posterUrl: 'https://via.placeholder.com/300x450?text=Avengers',
        isActive: true,
      },
      {
        title: 'Inception',
        description: 'A mind-bending thriller about dreams within dreams.',
        genre: ['Action', 'Sci-Fi', 'Thriller'],
        duration: 148,
        language: 'English',
        releaseDate: new Date('2010-07-16'),
        rating: 8.8,
        posterUrl: 'https://via.placeholder.com/300x450?text=Inception',
        isActive: true,
      },
      {
        title: 'The Dark Knight',
        description: 'Batman faces the Joker in this iconic superhero film.',
        genre: ['Action', 'Crime', 'Drama'],
        duration: 152,
        language: 'English',
        releaseDate: new Date('2008-07-18'),
        rating: 9.0,
        posterUrl: 'https://via.placeholder.com/300x450?text=Dark+Knight',
        isActive: true,
      },
    ];

    const createdMovies = [];
    for (const movieData of movies) {
      let movie = await Movie.findOne({ title: movieData.title });
      if (!movie) {
        movie = await Movie.create(movieData);
        createdMovies.push(movie);
        console.log(`✅ Movie created: ${movie.title}`);
      } else {
        createdMovies.push(movie);
        console.log(`ℹ️  Movie already exists: ${movie.title}`);
      }
    }

    // Create sample shows
    if (createdMovies.length > 0) {
      const cities = ['Chennai', 'Mumbai', 'Delhi', 'Bangalore'];
      const theatres = ['PVR Cinemas', 'INOX', 'Cinepolis', 'SPI Cinemas'];

      for (const movie of createdMovies) {
        for (let i = 0; i < 3; i++) {
          const showTime = new Date();
          showTime.setDate(showTime.getDate() + i);
          showTime.setHours(14 + i * 3, 0, 0, 0);

          const showData = {
            movieId: movie._id,
            theatreName: theatres[Math.floor(Math.random() * theatres.length)],
            city: cities[Math.floor(Math.random() * cities.length)],
            screen: `Screen ${Math.floor(Math.random() * 5) + 1}`,
            showTime,
            totalSeats: 50,
            basePrice: 250 + Math.floor(Math.random() * 200),
            isActive: true,
          };

          const existing = await Show.findOne({
            movieId: movie._id,
            theatreName: showData.theatreName,
            showTime: showData.showTime,
          });

          if (!existing) {
            await Show.create(showData);
            console.log(`✅ Show created for ${movie.title} at ${showData.theatreName}`);
          }
        }
      }
    }

    console.log('\n✅ Seeding completed!');
    console.log(`\nAdmin login: ${adminEmail} / admin123`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding error:', err);
    process.exit(1);
  }
}

seed();

